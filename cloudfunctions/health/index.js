/**
 * 云函数：health —— XingHo Read 的 API 入口
 *
 * 【它现在做什么】
 *   一个 HTTP 服务，按路径分发到不同接口：
 *     GET   /api/health        健康检查（不查数据库）
 *     GET   /api/folders       文件夹列表
 *     POST  /api/folders       新建文件夹
 *     PATCH /api/folders/:id   改文件夹名字（Day 22 新增）
 *     DELETE /api/folders/:id  删一个文件夹（Day 22 新增）
 *     GET   /api/materials     材料列表（可按文件夹筛选、可限条数）
 *
 * 【为什么还叫 health 这个名字】
 *   云函数的**名字**在创建时定死，改名要删掉重建。
 *   为了不破坏 Day 15 已上线的健康检查地址，保留函数名，
 *   但职责已经从「只做健康检查」扩成「承载全部 API」。
 *
 * ────────────────────────────────────────────────────────────
 * 【Day 19 做了分层重构 —— 先看这段，再改代码】
 *
 * 原来这个文件里混着三件事：路由、业务规则、查数据库。
 * 拆成四层，**每层只干一件事**：
 *
 *   index.js       接口层        路由分发、参数校验、组装响应
 *   repo.js        数据访问层    按业务取数据（文件夹 / 材料）
 *   db.js          数据库客户端  拼查询参数、发 HTTPS、解析错误
 *   http-utils.js  通用 HTTP 工具  send / ok / fail / readBody
 *
 * 【怎么判断拆得对不对 —— 三句话】
 *   index.js 里**不该出现数据库列名**（folder_id / created_at）
 *   repo.js  里**不该出现 HTTP**（req / res / 状态码）
 *   db.js    里**不该出现业务词**（文件夹 / 句段数）
 *
 * 【「查数据库」那段代码从哪移到了哪（Day 19 的核心问题）】
 *   原来 getFolders / getMaterials / createFolder 三个函数里，
 *   直接调 select / insert，还在内存里数材料数、数句段数，
 *   再把数据库的 snake_case 转成接口要的 camelCase。
 *   **这些全部移到 repo.js。**
 *   现在这三个处理函数只剩：读参数 → 校验 → 调 repo → 发响应。
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
 * 现在走 CloudBase HTTP API（PostgREST），访问逻辑全在 db.js 里。
 * 代价是**写不了 SQL**，只能拼查询参数 —— 所以「数材料数 / 数句段数」
 * 只能拆成两次请求在内存里数，那部分的说明在 repo.js。
 *
 * 【今天不做什么】
 *   DELETE 接口（板块② 做）、批量操作、用户系统；RLS 行级权限也还没配。
 */

const http = require('http')
const repo = require('./repo')
const { send, ok, fail, readBody, readJsonBody } = require('./http-utils')

// 平台通过环境变量注入端口；本地调试兜底用 9000
const PORT = process.env.PORT || 9000

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
 * 只做一件事：问 repo 要数据，包一层发给前端。
 *
 * **不含 'all'（全部材料）** —— 那是前端造出来的「看全部」入口，
 * 不是数据库里的真实记录。
 */
async function getFolders(res) {
  const folders = await repo.listFolders()
  ok(res, { folders })
}

// ── 接口 3：材料列表 ──────────────────────────────────────────

/**
 * GET /api/materials
 *   ?folderId=textbook   按文件夹筛选（不传或传 all = 取全部）
 *   ?limit=3             限制返回条数（1–100）
 *
 * 【校验为什么留在这里，不放进 repo】
 *   「limit 必须是 1–100 的整数」是**这个接口的规矩**，
 *   不是「数据本身的性质」—— 别的调用方（比如将来的后台任务）
 *   想一次取 500 条是合理的。
 *   凡是「用户输入不可信」的判断，都属于接口层。
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

  const materials = await repo.listMaterials({ folderId, limit })

  // 再包一层 materials，而不是直接给数组 ——
  // 将来要加 total / hasMore 时有地方放，不用改结构（契约 3.3 的理由）
  ok(res, { materials })
}

// ── 接口 4：新建文件夹 ────────────────────────────────────────

/**
 * POST /api/folders —— 新建一个文件夹
 *
 * 【这个接口要防的两种错】
 *
 * 1. **重复提交**（同一个 id 发两次）
 *    → repo 会原样抛出数据库的 409，这里翻译成人话。
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
    const folder = await repo.createFolder({ id, name })

    // 写操作单独记一条 —— 读请求记了「打了哪个接口」，
    // 写请求还要记「写进去了什么」，否则事后无法回答
    // 「用户说建了、库里的这一行到底是谁建的」。
    console.log(`[api] 新建文件夹成功：id=${folder.id} name=${folder.name}`)

    // 201 Created：明确表示「新建了一个资源」（契约 3.4）
    send(res, 201, {
      ok: true,
      data: { folder },
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

// ── 接口 5：修改文件夹（Day 22 新增）──────────────────────────

/**
 * PATCH /api/folders/:id —— 改文件夹名字
 *
 * 【为什么 id 在地址里，不在请求体里】
 *   地址里的 `:id` 回答「**改哪一条**」，请求体里的字段回答「**改成什么**」。
 *   这两件事分开，语义才清楚：
 *       PATCH /folders/news   { "name": "新闻英语" }    ← 把 news 改成「新闻英语」
 *   如果 id 也塞进请求体，就变成「给你一个 id 和一个名字，你自己猜我想干嘛」——
 *   多一个字段，就多一处可能写错。
 *
 * 【只允许改 name】
 *   见 `repo.updateFolder` 的说明：id 是所有材料关联文件夹的依据，不能改。
 *
 * 【「改」特有的错误（和「增」不一样）】
 *   1. **改一个不存在的 id → 必须 404。**
 *      这里如果回 200，前端会以为改成功了，刷新一看没变 —— 这叫**静默成功**，
 *      比报错难查得多。⚠️ 新增时「目标不存在」是正常的；修改时「目标不存在」是错误。
 *   2. **name 为空 / 超长 → 400**，在进数据库之前就挡掉（不然会先写脏数据）。
 *   3. **请求体不是对象 → 400**（由 readJsonBody 负责，见 http-utils.js）。
 */
async function updateFolder(req, res, id) {
  // ── 第 1 步：读 + 解析请求体 ─────────────────────────────
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    // isRequestError = 「用户输入不对」→ 该回 4xx，用错误自带的状态码和文案
    if (err.isRequestError) {
      return fail(res, err.status, err.error, err.message)
    }
    throw err   // 其它 = 程序出错了 → 交给 route 的兜底回 500
  }

  // ── 第 2 步：校验 name ──────────────────────────────────
  // 先 trim 再判断 —— 全是空格的名字等于没填
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!name) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹名称不能为空')
  }
  if (name.length > 30) {
    return fail(res, 400, 'BAD_REQUEST', '文件夹名称最多 30 个字符')
  }

  // ── 第 3 步：写入 ──────────────────────────────────────
  const folder = await repo.updateFolder({ id, name })

  // null = 没有这个 id（repo 层不碰 HTTP，所以用 null 表达「没这条」）
  if (!folder) {
    return fail(res, 404, 'NOT_FOUND', `没有找到 id 为「${id}」的文件夹`)
  }

  // 写操作记一条 —— 事后能回答「这个名字是谁改的」
  console.log(`[api] 修改文件夹成功：id=${folder.id} name=${folder.name}`)

  // 200 而不是 201：**没有创建新资源，只是改了现有的**
  ok(res, { folder })
}

// ── 接口 6：删除文件夹（Day 22 新增）──────────────────────────

/**
 * DELETE /api/folders/:id —— 删一个文件夹
 *
 * 【删除为什么比新增更容易出事】三条，全都体现在这个函数里：
 *   1. **不可逆** —— 新增错了能删掉；删除错了数据就没了。
 *      （本期是**真删**，没有软删除 —— 软删除是加练项。）
 *   2. **有连带影响** —— 文件夹里的材料会怎样？
 *      → 数据库**故意不允许**删还有材料的文件夹（外键挡着，见 `repo.deleteFolder`）。
 *   3. **容易「静默成功」** —— 删一个不存在的 id 如果回 200，
 *      调用方会以为删掉了，实际什么都没发生。→ **必须 404**。
 *
 * 【「确认」加在哪 —— 三层，从不可绕过到说人话】
 *   ① **数据库层**：外键约束。**这是最后一道防线，也是唯一不可绕过的一道** ——
 *      就算应用层写错了，数据库也不会让材料变孤儿。
 *   ② **业务层（repo）**：被数据库拦下来**之后**才去数「有几条」，
 *      把数字带回来。⚠️ 顺序是「先让数据库裁决，再补说明」，不是反过来。
 *   ③ **接口层（这里）**：把三种结果翻译成 200 / 404 / 409，并且**说人话**。
 *
 * 【为什么没有请求体】
 *   「删哪一条」全在地址里。DELETE 虽然允许带 body，但语义混乱、
 *   而且不少代理/网关会把它丢掉 —— 所以**这里不读 body**。
 */
async function deleteFolder(req, res, id) {
  const result = await repo.deleteFolder(id)

  // ── 情况一：删掉了 ────────────────────────────────────────
  if (result.deleted) {
    // 写操作单独记一条。**删除尤其要记** —— 它是不可逆的动作，
    // 事后必须能回答「这条是什么时候、被谁删的」。
    console.log(`[api] 删除文件夹成功：id=${result.folder.id} name=${result.folder.name}`)

    // 200 并把删掉的那条回给调用方（不是 204 空响应）：
    // 契约 1.4 要求「所有接口都返回 JSON」，前端也能据此显示「已删除「课本音频」」。
    return ok(res, { folder: result.folder })
  }

  // ── 情况二：本来就没有这条 → 404 ──────────────────────────
  // ⚠️ 绝不能回 200。回 200 就是**静默成功**：前端以为删了，其实什么都没发生。
  //    「删不存在的 id」和「删存在的 id」，调用方必须能分出来。
  if (result.reason === 'not-found') {
    return fail(res, 404, 'NOT_FOUND', `没有找到 id 为「${id}」的文件夹`)
  }

  // ── 情况三：里面还有材料 → 409 ────────────────────────────
  // 409 CONFLICT = 「你的请求没写错，但**数据现在的状态**不允许这么做」。
  // ⚠️ 不是 400（参数没错），也不是 500（服务器没坏）—— **读者不同，处理方式就不同**。
  // 提示语里带上**具体条数**：光说「不能删」，用户不知道下一步该干嘛。
  return fail(
    res,
    409,
    'CONFLICT',
    `「${result.name}」里还有 ${result.materialCount} 条材料，先把它们移走或删掉，再删这个文件夹`
  )
}

// ── 路由分发 ─────────────────────────────────────────────────

/**
 * 根据**路径 + 请求方法**找对应的处理函数。
 *
 * 【为什么要看方法】
 *   同一个路径 /api/folders 有两种用法：
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

    // ── 带路径参数的路径：/folders/<id>（Day 22 新增）──────────
    // 【为什么需要单独一段】上面那种 `pathname === '/folders'` 是**精确比较**，
    //   匹配不上 `/folders/news`。带参数的路径必须用正则。
    //
    // 【正则怎么读】
    //   ^\/(?:api\/)?folders\/([^/]+)$
    //     (?:api\/)?   可选的 `api/` 前缀 —— 本地调试有、过网关后没有（见文件头说明）
    //     ([^/]+)      捕获 id，**至少一个非斜杠字符**
    //                  → 所以 `/folders/`（id 为空）匹配不上，会落到最后返回 404
    //                  → 所以 `/folders/a/b` 也匹配不上（id 里不能有斜杠）
    const folderIdMatch = pathname.match(/^\/(?:api\/)?folders\/([^/]+)$/)
    if (folderIdMatch) {
      // id 可能是百分号编码过的（比如中文），解回来再用
      const id = decodeURIComponent(folderIdMatch[1])

      if (method === 'PATCH') {
        await updateFolder(req, res, id)
        return true
      }

      if (method === 'DELETE') {
        await deleteFolder(req, res, id)
        return true
      }

      // 路径对、方法不对 —— 和其它接口一样回 405
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

  // ── 跨域预检请求（OPTIONS）────────────────────────────────
  // 【这是什么】浏览器在发「POST + JSON」这种请求之前，会**先发一个 OPTIONS 探路**：
  //   「我准备用 POST、带 Content-Type: application/json 打你这个地址，行不行？」
  //   答完这一句，浏览器才发真正的请求。
  //
  // 【为什么要在函数里处理】网关会把 OPTIONS **转发给函数**，
  //   所以函数必须接住它 —— 否则会掉进路由、返回 404，让预检失败。
  //   这里不用跑业务逻辑（不查库、不校验），回 204（成功无内容）就够。
  //
  // ⚠️ CORS 响应头**不在这里加** —— 网关会加，两套会冲突成非法值。
  //    实测记录见 http-utils.js 的「跨域」注释块。
  // ⚠️ 漏了这个分支，POST 接口在浏览器里**直接失败**，而用 curl 测却是好的
  //    （curl 不发预检）—— 这是最容易被骗过去的一类 bug。
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

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
