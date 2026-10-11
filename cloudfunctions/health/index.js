/**
 * 云函数：health —— 现在承载 XingHo Read 的全部 API
 *
 * 【它现在做什么】
 *   一个 HTTP 服务，按路径分发到不同接口：
 *     GET  /api/health     健康检查（不查数据库）
 *     GET  /api/folders    文件夹列表
 *     POST /api/folders    新建文件夹（Day 18 新增）
 *     GET  /api/materials  材料列表（可按文件夹筛选、可限条数）
 *
 * 【为什么还叫 health 这个名字】
 *   云函数的**名字**在创建时定死，改名要删掉重建。
 *   为了不破坏 Day 15 已上线的健康检查地址，保留函数名，
 *   但职责已经从「只做健康检查」扩成「承载全部 API」。
 *
 * 【Day 17 新增了什么】
 *   两个读接口。它们从 PostgreSQL 读真实数据 ——
 *   Day 16 建的三张表第一次被接口读出来。
 *
 * 【今天不做什么】
 *   修改/删除接口（PATCH、DELETE）留到第 4 周；RLS 行级权限也还没配。
 *   ⚠️ 排查用的临时端点 GET /api/debug 已在 Day 18 收尾时删除。
 *
 * ────────────────────────────────────────────────────────────
 * 【为什么是这个写法（Day 15 踩过坑，别改）】
 *
 * 云函数有两种类型：
 *   1. 事件型：exports.main = (event) => {...}，平台帮你听请求
 *   2. Web 函数：自己起 HTTP 服务 listen 到 PORT 上
 *
 * 本项目用第 2 种 —— 接口多起来时能按 req.url 干净地分发路由。
 *
 * ⚠️ PORT 必须从 process.env.PORT 读，不能写死 9000。
 *
 * 【路由为什么每个路径都认两种写法】
 *   cloudbaserc.json 里配了 gatewayPath: "/api"。
 *   腾讯云网关会把这段前缀**从传给函数的路径里减掉**：
 *       外部 /api/materials → 函数收到 /materials
 *       外部 /api/health    → 函数收到 /health
 *   本地直连调试时没有网关剥前缀，收到的是完整路径 /api/materials。
 *   两种都认，同一份代码本地和线上都能跑。
 *
 * ────────────────────────────────────────────────────────────
 * 【Day 17 中途换过方案 —— 这里记清楚，别走回头路】
 *
 * 原本写的是 pg 直连（自己建连接池、写 SQL）。部署前在控制台发现
 * **共享集群不提供外网地址**，云函数够不着数据库，直连作废。
 *
 * 现在走 CloudBase HTTP API（PostgREST），访问逻辑全在 db.js 里。
 * 代价是：**写不了 SQL**，只能拼查询参数。
 * 所以下面两处算法跟原计划不一样：
 *   1. folders 的 count  —— 原来一条带 GROUP BY 的 SQL 就够，
 *      现在要「先取文件夹，再逐个数字段」。
 *   2. sentenceCount 同理。
 * 数据量小（5 个文件夹 / 6 条材料）时这点开销无所谓；
 * 将来材料多到几百条，这里要改成在数据库里建视图（记进待办）。
 */

const http = require('http')
const { select, insert, count } = require('./db')

// 平台通过环境变量注入端口；本地调试兜底用 9000
const PORT = process.env.PORT || 9000

// ── 响应工具 ─────────────────────────────────────────────────

/**
 * 发一个 JSON 响应。
 * Content-Length 按**字节**算，不是字符串长度 ——
 * 中文一个字占 3 字节，用 length 会算少，响应会被截断。
 */
function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 成功响应：统一 { ok, data, time }（契约 1.4） */
function ok(res, data) {
  send(res, 200, { ok: true, data, time: new Date().toISOString() })
}

/** 失败响应：统一 { ok, error, message, time }（契约 1.4） */
function fail(res, status, error, message) {
  send(res, status, { ok: false, error, message, time: new Date().toISOString() })
}

// ── 接口 1：健康检查 ──────────────────────────────────────────

/**
 * 不查数据库，只证明服务活着。
 *
 * ⚠️ 这是**唯一不遵守 1.4 统一格式**的接口（返回 service 而不是 data）。
 *    原因见 api-contract.md 2.1：它比统一约定更早实现。
 *    **保持原样不改** —— 改了会破坏 Day 15 建立的验证方法。
 */
function getHealth(res) {
  send(res, 200, {
    ok: true,
    service: 'xingho-read',
    time: new Date().toISOString(),
  })
}

// ── 接口 2：文件夹列表 ────────────────────────────────────────

/**
 * GET /api/folders
 *
 * 返回全部文件夹。**不含 'all'（全部材料）** ——
 * 那是前端造出来的「看全部」入口，不是数据库里的真实记录。
 *
 * 每个文件夹带一个 `count`（里面有几条材料）。
 * 因为 HTTP API 不能写 JOIN/GROUP BY，只能：
 *   ① 取全部文件夹
 *   ② 取全部材料（只要 folder_id 一列，省流量）
 *   ③ 在服务器内存里数一遍
 * 数据量小时这样最省事。
 */
async function getFolders(res) {
  const [folders, materials] = await Promise.all([
    // ⚠️ 排序必须加 id 做次序键（Day 18 修的）：
    //    seed 数据里 5 个文件夹的 created_at **完全相同**，
    //    只按 created_at 排序时数据库返回顺序是**不保证的** ——
    //    实测带 limit 的查询会返回 2、1 这种乱序。
    //    加上 id.asc 后顺序才是确定的。
    select('folders', { select: 'id,name,created_at', order: 'created_at.asc,id.asc' }),
    select('materials', { select: 'folder_id' }),
  ])

  // 先把材料按文件夹分组数好，避免对每个文件夹都扫一遍数组
  const countByFolder = new Map()
  for (const m of materials) {
    countByFolder.set(m.folder_id, (countByFolder.get(m.folder_id) || 0) + 1)
  }

  // 列名转换：数据库的 created_at → 接口的 createdAt（契约 3.1）
  const data = folders.map((f) => ({
    id: f.id,
    name: f.name,
    count: countByFolder.get(f.id) || 0,
    createdAt: f.created_at,
  }))

  ok(res, { folders: data })
}

// ── 接口 3：材料列表 ──────────────────────────────────────────

/**
 * GET /api/materials
 *   ?folderId=textbook   按文件夹筛选（不传或传 all = 取全部）
 *   ?limit=3             限制返回条数（1–100）
 *
 * 两个要点：
 *
 * 1. 一条材料要带「有几个句段」（sentenceCount）
 *    数据库没有这一列，得从 sentences 表数出来。
 *    直连方案里用一条 LEFT JOIN + count() 就能算，
 *    但 HTTP API 不能写 JOIN，只能：
 *      ① 取材料列表
 *      ② 取这些材料的句段（只要 material_id 一列）
 *      ③ 在内存里数
 *    ⚠️ 注意：**没有句段的材料也要出现**（句段数 0）。
 *       所以第 ② 步的结果为空时，材料本身照样返回。
 *
 * 2. limit 必须校验
 *    来自用户输入，不能信。非整数、越界一律 400。
 */
async function getMaterials(res, url) {
  const folderId = url.searchParams.get('folderId')
  const limitRaw = url.searchParams.get('limit')

  // ── 校验 limit（用户输入不可信）──────────────────────────
  let limit
  if (limitRaw !== null) {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return fail(res, 400, 'BAD_REQUEST', 'limit 必须是 1 到 100 之间的整数')
    }
    limit = n
  }

  // ── 取材料 ───────────────────────────────────────────────
  // filter 里放 undefined 表示不筛，db.js 会自动跳过
  const materials = await select('materials', {
    select: 'id,title,folder_id,audio_url,created_at',
    filter: folderId && folderId !== 'all' ? { folder_id: folderId } : {},
    // 加 id 做次序键 —— 理由同 getFolders（created_at 全相同，单排它不定序）
    order: 'created_at.asc,id.asc',
    limit,
  })

  // ── 数每个材料的句段数 ────────────────────────────────────
  // 一次取回全部句段的 material_id，在内存里分组
  const sentences = await select('sentences', { select: 'material_id' })
  const sentenceCountByMaterial = new Map()
  for (const s of sentences) {
    sentenceCountByMaterial.set(
      s.material_id,
      (sentenceCountByMaterial.get(s.material_id) || 0) + 1
    )
  }

  const data = materials.map((m) => ({
    id: m.id,
    title: m.title,
    folderId: m.folder_id,
    audioUrl: m.audio_url,
    sentenceCount: sentenceCountByMaterial.get(m.id) || 0,
    createdAt: m.created_at,
  }))

  // data 里再包一层 materials，而不是直接给数组 ——
  // 将来要加 total / hasMore 时有地方放，不用改结构（契约 3.3 的理由）
  ok(res, { materials: data })
}

// 说明：count() 目前两个接口都没用上，先留着（Day 18 分页要它）。
// 保留它还有个作用 —— 它验证了「响应头 Content-Range 能读到总数」这条路是通的。
void count

// ── 接口 4：新建文件夹（Day 18 新增）─────────────────────────

/**
 * 把请求体读成一个字符串。
 *
 * 【为什么要自己读】
 *   Node 的 http 请求体是**流**（一段一段来的），不像 Express 那样
 *   自动帮你收好、还帮你解析 JSON。原生写法要自己收。
 *
 * 【为什么要有大小上限】
 *   如果客户端一直发、我们一直收，内存会被撑爆。
 *   超过 64 KB 就拒绝 —— 一个文件夹只有两个短字段，64 KB 绰绰有余。
 *   （将来传音频是走文件存储，**不经过这里**，见契约第四节。）
 *
 * @returns {Promise<string>} 请求体的原始文本
 */
function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        const err = new Error('请求体超出大小限制')
        err.tooLarge = true
        reject(err)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    // 按 utf8 拼 —— 中文一个字 3 字节，用二进制拼完再解码才不会断字
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (err) => reject(err))
  })
}

/**
 * POST /api/folders —— 新建一个文件夹
 *
 * 【这个接口今天要防的两种错】
 *
 * 1. **重复提交**（同一个 id 发两次）
 *    → 交给数据库的主键约束拦，返回 409 CONFLICT。
 *    ⚠️ 不用「先查有没有、没有就插」—— 两个请求同时来会一起通过检查、
 *       一起插入，这叫**竞态条件**。让数据库当裁判才是唯一可信的。
 *
 * 2. **缺必填字段 / 格式不对**
 *    → **在进数据库之前**就挡掉，返回 400 + 中文说明。
 *    ⚠️ 顺序很重要：先校验、后入库。不然会先写进脏数据再报错。
 */
async function createFolder(req, res) {
  // ── 第 1 步：读请求体 ──────────────────────────────────────
  let raw
  try {
    raw = await readBody(req)
  } catch (err) {
    if (err.tooLarge) {
      return fail(res, 413, 'PAYLOAD_TOO_LARGE', '提交的内容太大了')
    }
    throw err
  }

  // ── 第 2 步：解析 JSON ────────────────────────────────────
  // 用户发来的东西**永远不可信**：可能是空、可能是半个 JSON、
  // 可能是一个数组。每种情况都要给一句人能看懂的话。
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return fail(res, 400, 'BAD_REQUEST', '请求体不是合法的 JSON')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(res, 400, 'BAD_REQUEST', '请求体必须是一个 JSON 对象')
  }

  // ── 第 3 步：校验字段 ────────────────────────────────────
  // 先 trim 再判断 —— 全是空格的 name 等于没填
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!id) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹 id 不能为空')
  }
  // id 会进主键、也可能被拼进 URL，限制字符集能避免一堆麻烦
  if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹 id 只能用小写字母、数字、下划线或短横线，且不超过 32 个字符')
  }
  if (!name) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹名称不能为空')
  }
  if (name.length > 30) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹名称最多 30 个字符')
  }

  // ── 第 4 步：写入 ────────────────────────────────────────
  try {
    const row = await insert('folders', { id, name })

    // 写操作单独记一条 —— 读请求记了「打了哪个接口」，
    // 写请求还要记「写进去了什么」，否则事后无法回答
    // 「用户说建了、库里的这一行到底是谁建的」。
    console.log(`[api] 新建文件夹成功：id=${row.id} name=${row.name}`)

    // 201 Created：明确表示「新建了一个资源」（契约 3.4）
    send(res, 201, {
      ok: true,
      data: {
        folder: {
          id: row.id,
          name: row.name,
          count: 0,                   // 新文件夹里当然没有材料
          createdAt: row.created_at,  // 数据库生成的，从插入结果里读回来
        },
      },
      time: new Date().toISOString(),
    })
  } catch (err) {
    // 409 = 主键冲突 = 这个 id 已经有了 → 翻译成人话
    if (err.status === 409) {
      return fail(res, 409, 'CONFLICT', '这个文件夹已经存在了')
    }
    // 其它错误（连不上、SQL 出错）交给 route 的兜底：记日志、返回 500
    throw err
  }
}

// ── 路由分发 ─────────────────────────────────────────────────

/**
 * 根据**路径 + 请求方法**找对应的处理函数。
 *
 * 【为什么现在要看方法（Day 18 新增）】
 *   同一个路径 /api/folders 现在有两种用法：
 *     GET  → 取列表
 *     POST → 新建
 *   只看路径不够了，必须连方法一起判断。
 *
 * 【为什么其它方法要回 405 而不是 404】
 *   路径是对的、只是方法不对 —— 这叫 405 Method Not Allowed。
 *   回 404 会让调用方以为「接口不存在」，去改地址；
 *   回 405 才说得清「地址没错，是你的用法不对」。
 *
 * @returns {Promise<boolean>} 是否已处理（false = 没匹配上，交给调用方返回 404）
 */
async function route(pathname, url, req, res) {
  try {
    const method = req.method

    if (pathname === '/' || pathname === '/health' || pathname === '/api/health') {
      getHealth(res)
      return true
    }

    if (pathname === '/folders' || pathname === '/api/folders') {
      if (method === 'GET') {
        await getFolders(res)
        return true
      }
      if (method === 'POST') {
        await createFolder(req, res)
        return true
      }
      fail(res, 405, 'METHOD_NOT_ALLOWED', `这个接口不支持 ${method} 请求`)
      return true
    }

    if (pathname === '/materials' || pathname === '/api/materials') {
      if (method === 'GET') {
        await getMaterials(res, url)
        return true
      }
      fail(res, 405, 'METHOD_NOT_ALLOWED', `这个接口不支持 ${method} 请求`)
      return true
    }

    return false
  } catch (err) {
    // 连不上数据库、API Key 没配、网关报错……都落在这里。
    // 给用户看的是「说人话」的提示，技术细节只进日志（契约 1.5 的原则）
    console.error('[api] 接口出错：', err)
    fail(res, 500, 'INTERNAL_ERROR', '服务出问题了，请稍后再试')
    return true
  }
}

// ── 启动 HTTP 服务 ───────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now()

  // req.url 可能带查询串（如 /materials?limit=3），
  // 用 URL 解析出纯路径和参数，避免查询串影响路由匹配
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ── 【加练 · Day 18】请求日志 ──────────────────────────────
  // 云函数没有常驻的控制台窗口，出了问题只能靠日志回放。
  // 记「方法 + 路径 + 状态码 + 耗时」四样就够定位大部分问题：
  //   请求到没到？被哪一层拒的（400/405/409/500）？是不是慢在数据库上？
  // ⚠️ 只记元信息 —— 不记请求体（可能含用户内容）、不记任何密钥。
  // 'finish' 事件在响应发完后触发，这时 res.statusCode 已是最终值。
  res.on('finish', () => {
    console.log(
      `[api] ${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - startedAt}ms)`
    )
  })

  // 注意把 req 也传进去 —— POST 接口要读请求体，body 挂在 req 上
  const handled = await route(url.pathname, url, req, res)

  if (!handled) {
    fail(res, 404, 'NOT_FOUND', `没有这个接口：${url.pathname}`)
  }
})

server.listen(PORT, () => {
  console.log(`[api] 服务已启动，监听端口 ${PORT}`)
})

// 兜底：进程一旦退出，云端不会自动重启，表现是「网站突然打不开且没有提示」。
// 至少把原因打进日志，方便排查。
process.on('uncaughtException', (err) => {
  console.error('[api] 未捕获异常：', err)
})
