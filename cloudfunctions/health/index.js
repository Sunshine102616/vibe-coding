/**
 * 云函数：health —— 现在承载 XingHo Read 的全部 API
 *
 * 【它现在做什么】
 *   一个 HTTP 服务，按路径分发到不同接口：
 *     GET /api/health     健康检查（不查数据库）
 *     GET /api/folders    文件夹列表
 *     GET /api/materials  材料列表（可按文件夹筛选、可限条数）
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
 *   写接口（新建/修改/删除）留到 Day 18；RLS 行级权限也还没配。
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
const { select, count } = require('./db')

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
    select('folders', { select: 'id,name,created_at', order: 'created_at.asc' }),
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
    order: 'created_at.asc',
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

// ── 路由分发 ─────────────────────────────────────────────────

/**
 * 根据路径找对应的处理函数。
 * @returns {Promise<boolean>} 是否已处理（false = 没匹配上，交给调用方返回 404）
 */
async function route(pathname, url, res) {
  try {
    if (pathname === '/' || pathname === '/health' || pathname === '/api/health') {
      getHealth(res)
      return true
    }

    if (pathname === '/folders' || pathname === '/api/folders') {
      await getFolders(res)
      return true
    }

    if (pathname === '/materials' || pathname === '/api/materials') {
      await getMaterials(res, url)
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
  // req.url 可能带查询串（如 /materials?limit=3），
  // 用 URL 解析出纯路径和参数，避免查询串影响路由匹配
  const url = new URL(req.url, `http://localhost:${PORT}`)

  const handled = await route(url.pathname, url, res)

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
