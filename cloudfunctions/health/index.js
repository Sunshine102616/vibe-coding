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
 *   http-utils.js  通用 HTTP 工具  send / ok / fail / readJsonBody
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
const { send, ok, fail, readJsonBody } = require('./http-utils')

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

// ── 接口 7：取单条材料（Day 27 新增）──────────────────────────

/**
 * GET /api/materials/:id —— 取一条材料，连同它的全部句段
 *
 * 【为什么练习页需要它】
 *   练习页要逐句显示、逐句播放，所以需要「这条材料的每一句」。
 *   列表接口（`GET /api/materials`）只给 `sentenceCount` 一个数字，拿不到句子本身。
 *
 * 【为什么找不到要回 404，而不是 200 + 空数据】
 *   和 PATCH / DELETE 同一个道理：**目标不存在就是错误**。
 *   如果回 200 但 `sentences` 是空数组，前端会显示「这条材料有 0 句话」——
 *   用户看到的不是「材料不存在」，而是「材料坏了」，**误导的方向完全错了**。
 *   ⚠️ 这也正是练习页以前那个假故障：点 id 4/5/6 显示「找不到」，
 *      根因就是拿 mock 名单去查真数据。
 */
async function getMaterial(res, id) {
  const material = await repo.getMaterial(id)

  // null = 没有这个 id（repo 层不碰 HTTP，所以用 null 表达「没这条」）
  if (!material) {
    return fail(res, 404, 'NOT_FOUND', `没有找到 id 为「${id}」的材料`)
  }

  ok(res, { material })
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
  // ── 第 1 步：读 + 解析请求体 ──────────────────────────────
  // 【Day 23 统一】「读流 / 解析 JSON / 确认是对象」这三步原来内联在这里，
  //   与 updateFolder 用的 readJsonBody 是**两份实现** —— 大小上限和错误文案
  //   要改两遍，早晚会不同步。现在统一走 readJsonBody（三类错误的文案只写一处）。
  //   用户发来的东西**永远不可信**：可能是空、可能是半个 JSON、可能是一个数组。
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

  // ── 第 2 步：校验字段 ────────────────────────────────────
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

  // ── 第 3 步：写入 ────────────────────────────────────────
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
      if (method === 'POST') {
        await createMaterial(req, res)
        return true
      }
      fail(res, 405, 'METHOD_NOT_ALLOWED', `这个接口不支持 ${method} 请求`)
      return true
    }

    // ── 带路径参数的路径：/materials/<id>（Day 27 新增）────────
    // 和上面 `/folders/<id>` 同一个套路：精确比较匹配不上带参数的路径，必须用正则。
    // 【为什么放在 `/materials` 精确比较之后】
    //   正则要求「`/materials/` 后面至少一个非斜杠字符」，所以它本来也匹配不上
    //   `/materials`；但**写在后面读起来更安全** —— 一眼就能看出「先精确、后带参数」，
    //   不必去推演正则的行为。（顺序靠巧合正确，是将来最容易改坏的一类代码。）
    const materialIdMatch = pathname.match(/^\/(?:api\/)?materials\/([^/]+)$/)
    if (materialIdMatch) {
      // id 可能是百分号编码过的（比如中文），解回来再用
      const id = decodeURIComponent(materialIdMatch[1])

      if (method === 'GET') {
        await getMaterial(res, id)
        return true
      }

      // 路径对、方法不对 —— 和其它接口一样回 405
      fail(res, 405, 'METHOD_NOT_ALLOWED', `这个接口不支持 ${method} 请求`)
      return true
    }

    return false
  } catch (err) {
    // 连不上数据库、API Key 没配、网关报错……都落在这里。
    // 给用户看的是「说人话」的提示，技术细节只进日志（契约 1.5 的原则）
    console.error('[api] 接口出错：', err)

    // ── 【Day 27 加】把「配置没做好」和「临时故障」分开 ────────────────
    //
    // 这两类都该回 500（确实是服务器的问题，不是用户操作错），
    // 但**提示语必须不同**：
    //   · 临时故障（网络抖、数据库忙）→ 「稍后再试」是有用的建议
    //   · 配置没做（没授权、没建表、没配密钥）→ 「稍后再试」是**骗人的**：
    //     试一万次也不会好。用户会一直点、一直以为是自己手气不好，
    //     最后自己编一个理由放弃 —— 这就是 Day 14 记下的「沉默的失败」。
    //
    // db.js 已经把 SQLSTATE 翻成中文了（err.code 是**剥过 `DATABASE_` 前缀**的），
    // 这里只挑「重试没用」的那几个，换成能指向真正原因的话。
    // ⚠️ 键写成字符串：SQLSTATE 是**定长字符串**，不是数字（42P01 带字母）。
    const CONFIG_ERRORS = {
      // insufficient_privilege：表在，但没授权。最典型的是新增一张要写的表
      // 之后忘了 `GRANT INSERT ON public.<表> TO anon;`（Day 18 踩过）
      '42501': '数据库还没给这张表开写权限，需要在数据库里授权之后才能用（不是你的操作问题）',
      // undefined_table：连表都没建，建表脚本没跑
      '42P01': '数据库里没有这张表，需要先执行建表脚本（不是你的操作问题）',
      // 缺少 API Key 环境变量 —— db.js 提前抛的，同样是「重试没用」那一类
      CONFIG: '云函数缺少数据库访问密钥，需要在云函数配置里补上（不是你的操作问题）',
    }

    // 没有 err.code 的那类（比如密钥缺失，是 db.js 自己抛的 Error）
    const key = err.code || (/CLOUDBASE_API_KEY/.test(err.message) ? 'CONFIG' : '')

    if (CONFIG_ERRORS[key]) {
      // 用**独立**的 error 代号，方便日后在日志里一眼认出「这不是故障，是没配好」
      fail(res, 500, 'CONFIG_ERROR', CONFIG_ERRORS[key])
      return true
    }

    fail(res, 500, 'INTERNAL_ERROR', '服务出问题了，请稍后再试')
    return true
  }
}

// ── 接口 8：新建材料（Day 27 新增）──────────────────────────

// 上限**只写一处**，校验和文案都用它 —— 两边写死两个数字早晚会不一致（Day 24 的 Bug D）。
const MAX_TITLE_LENGTH = 100
const MAX_SENTENCE_TEXT_LENGTH = 500
const MAX_AUDIO_URL_LENGTH = 500
const MAX_SENTENCE_COUNT = 500

/**
 * 生成材料 id。
 *
 * 【为什么由服务端生成，不让前端传】
 *   材料 id 会进地址栏（`#/practice/<id>`），而且它是**主键**。
 *   让前端传，就等于把「主键由客户端决定」写进契约 ——
 *   前端算重复了就是一个 409，用户看到的是莫名其妙的报错。
 *   服务端生成就没这个问题。
 *
 * 【为什么不是自增数字】
 *   表里 `id` 是 text，没有 sequence。要改成自增得动表结构，
 *   而这里唯一的要求是「唯一、短、能进 URL」——时间戳 + 随机后缀就够了。
 *   前缀 `m` 让人一眼看出「这是材料」（和 seed 里的 '1'、'2' 区分开）。
 */
function newMaterialId() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 校验并规整句段数组。返回 `{ sentences }` 或 `{ error: '中文提示' }`。
 *
 * 【为什么校验要写得这么细】
 *   句段是**用户填的文本 + 前端算出来的时间**，两样都不可信：
 *     序号可能重复（数据库主键是 (material_id, no)，重复会 409）
 *     终点可能小于起点（数据库有 CHECK 约束，违反会 400 但报错看不懂）
 *     文本可能是 null（这是**合法的**，PRD 明确「不填文本也能保存」）
 *   ⚠️ **在进数据库之前挡掉**，报错才说得清楚。让数据库去拒，
 *      用户看到的是 `DATABASE_23514` 这种天书。
 */
function parseSentences(raw) {
  // 不传 / 传 null = 这条材料没有句段（正常情况，不是错误）
  if (raw === undefined || raw === null) return { sentences: [] }

  if (!Array.isArray(raw)) return { error: '句段（sentences）必须是数组' }
  if (raw.length > MAX_SENTENCE_COUNT) {
    return { error: `一条材料最多 ${MAX_SENTENCE_COUNT} 个句段` }
  }

  const out = []
  const seenNo = new Set()

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    const at = `第 ${i + 1} 个句段`

    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { error: `${at}不是一个对象` }
    }

    // ── 序号 ──────────────────────────────────────────────
    if (!Number.isInteger(s.no) || s.no < 1) {
      return { error: `${at}的序号（no）必须是 1 以上的整数` }
    }
    if (seenNo.has(s.no)) {
      return { error: `句段序号 ${s.no} 重复了` }
    }
    seenNo.add(s.no)

    // ── 文本（可以是 null / 空字符串 —— 都当「没填」）─────
    let text = null
    if (s.text !== undefined && s.text !== null && s.text !== '') {
      if (typeof s.text !== 'string') return { error: `${at}的文本（text）必须是字符串` }
      const trimmed = s.text.trim()
      if (trimmed.length > MAX_SENTENCE_TEXT_LENGTH) {
        return { error: `${at}的文本最多 ${MAX_SENTENCE_TEXT_LENGTH} 个字符` }
      }
      text = trimmed === '' ? null : trimmed
    }

    // ── 起止时间 ──────────────────────────────────────────
    if (!Number.isInteger(s.startMs) || s.startMs < 0) {
      return { error: `${at}的起点（startMs）必须是不小于 0 的整数（毫秒）` }
    }
    if (!Number.isInteger(s.endMs) || s.endMs <= s.startMs) {
      return { error: `${at}的终点（endMs）必须大于起点（startMs）` }
    }

    out.push({ no: s.no, text, startMs: s.startMs, endMs: s.endMs })
  }

  // 进来就排好序 —— 数据库不保证返回顺序（repo.getMaterial 的说明），
  // 这里排一次，后面读写都省心。
  out.sort((a, b) => a.no - b.no)

  return { sentences: out }
}

/**
 * POST /api/materials —— 新建一条材料（可带句段）
 *
 * 【请求体】
 *   {
 *     "title": "VOA 慢速英语 0902",      必填，≤ 100 字
 *     "folderId": "listening",            必填，必须已存在
 *     "audioUrl": "https://…/a.mp3",      选填；填了必须以 http(s):// 开头
 *     "sentences": [ {no,text,startMs,endMs}, … ]   选填
 *   }
 *   ⚠️ **id 不用传**，服务端生成。
 *
 * 【为什么「文件夹不存在」要回 400 而不是 500】
 *   数据库会给一个外键冲突（23503），但那是**用户填错了文件夹**，
 *   不是服务器坏了。400 才是对的 —— 而且提示里要带上那个 id，
 *   用户才知道自己填的是什么。
 */
async function createMaterial(req, res) {
  // ── 第 1 步：读 + 解析请求体 ─────────────────────────────
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err.isRequestError) {
      return fail(res, err.status, err.error, err.message)
    }
    throw err
  }

  // ── 第 2 步：校验 ────────────────────────────────────────
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const folderId = typeof body.folderId === 'string' ? body.folderId.trim() : ''

  if (!title) return fail(res, 400, 'BAD_REQUEST', '材料标题不能为空')
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(res, 400, 'BAD_REQUEST', `材料标题最多 ${MAX_TITLE_LENGTH} 个字符`)
  }
  if (!folderId) return fail(res, 400, 'BAD_REQUEST', '必须指定所属文件夹')

  // 音频地址：选填。填了就必须是个能用的 http(s) 地址 ——
  // 存一个 `javascript:` 或随便一串字进去，练习页会加载失败，
  // 而用户完全不知道是自己填错了。
  let audioUrl = null
  const rawAudio = body.audioUrl
  if (rawAudio !== undefined && rawAudio !== null && rawAudio !== '') {
    if (typeof rawAudio !== 'string') {
      return fail(res, 400, 'BAD_REQUEST', '音频地址（audioUrl）必须是字符串')
    }
    audioUrl = rawAudio.trim()
    if (audioUrl.length > MAX_AUDIO_URL_LENGTH) {
      return fail(res, 400, 'BAD_REQUEST', `音频地址最多 ${MAX_AUDIO_URL_LENGTH} 个字符`)
    }
    if (!/^https?:\/\//i.test(audioUrl)) {
      return fail(res, 400, 'BAD_REQUEST', '音频地址必须以 http:// 或 https:// 开头')
    }
  }

  const parsed = parseSentences(body.sentences)
  if (parsed.error) return fail(res, 400, 'BAD_REQUEST', parsed.error)

  // ── 第 3 步：写入 ────────────────────────────────────────
  const id = newMaterialId()

  try {
    const material = await repo.createMaterial({
      id,
      title,
      folderId,
      audioUrl,
      sentences: parsed.sentences,
    })

    // 写操作单独记一条 —— 事后能回答「这条材料是谁、什么时候建的」
    console.log(
      `[api] 新建材料成功：id=${id} title=${title} folder=${folderId} 句段=${parsed.sentences.length}`
    )

    // 201 Created：明确表示「新建了一个资源」
    send(res, 201, { ok: true, data: { material }, time: new Date().toISOString() })
  } catch (err) {
    // 23503 = 外键冲突 = 这个 folderId 不存在
    if (err.code === '23503') {
      return fail(res, 400, 'BAD_REQUEST', `所属文件夹不存在（id：${folderId}）`)
    }
    // 其它错误（含句段插入失败后的补偿）交给 route 的兜底：记日志、返回 500
    throw err
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
