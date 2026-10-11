// ============================================================
// HTTP 通用工具（http-utils.js）—— Day 19 从 index.js 拆出
// ============================================================
//
// 【这一层做什么】
//   跟 HTTP 打交道的通用工具：发响应、读请求体。
//   跟「业务」和「数据库」都无关 —— 将来加新接口直接复用。
//
// 【为什么从 index.js 拆出来】
//   index.js 把数据访问拆走之后，剩下的应该只有「路由」。
//   响应格式、读请求体这些是通用工具，留在 index.js 里会稀释它的职责 ——
//   一个文件里既有「这个接口做什么」又有「怎么把 JSON 写出去」，
//   想找路由就要在一堆工具函数里翻。
//
// 【为什么 readBody 也算「HTTP 工具」而不是业务】
//   它只做一件事：把 Node 的请求流收成一个字符串。
//   收完之后是 JSON 还是表单、字段对不对，都是调用方的事。
// ============================================================

// ── 跨域（CORS）：由网关处理，函数**不要**自己加 ──────────────
//
// 【踩过的坑（Day 19 追加② 实测）】
//   一开始在函数里加了 `Access-Control-Allow-Origin: *` 等头，结果线上响应变成：
//       access-control-allow-origin: http://localhost:5173,*
//   —— 网关**自己也会加** CORS 头，两套拼在一起成了**非法值**，
//   浏览器判定不匹配，跨域直接失败。**加了反而更糟。**
//
// 【实测结论：网关全包】撤掉函数里的 CORS 头之后，网关单独提供（GET / OPTIONS / POST 都测过）：
//       access-control-allow-origin: <回显请求的 Origin>
//       access-control-allow-credentials: true
//       access-control-allow-methods: <预检请求里的那个方法>
//       access-control-allow-headers: Content-Type
//       vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
//   而且它做得比我们更对：**回显 Origin**（不是 `*`，这样才能配 credentials）、
//   预检只允许请求的那一个方法、还带了 `vary`（缓存正确性）。
//
// 【所以】函数这边只需要在 index.js 里把 OPTIONS 回一个 204 —— 见那里的说明。
//   ⚠️ 将来若换了部署方式（不经过这个网关），这里要**重新验证**一遍。

/**
 * 发一个 JSON 响应。
 *
 * ⚠️ Content-Length 按**字节**算，不是字符串长度 ——
 *    中文一个字占 3 字节，用 .length 会算少，响应会被截断。
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
 *   （将来传音频走文件存储，**不经过这里**，见契约第四节。）
 *
 * 超限时 reject 的 Error 上带 `tooLarge = true`，
 * 调用方据此回 413（见 index.js 的 createFolder）。
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

// ── 读 + 解析 JSON 请求体（Day 22 新增）──────────────────────

/**
 * 造一个「带 HTTP 语义」的错误，给 readJsonBody 用。
 *
 * 为什么错误对象上要带 status / error：**让调用方能一行翻译成响应**。
 *   调用方（index.js）只要 `fail(res, err.status, err.error, err.message)` 就行，
 *   不用自己判断「这是 413 还是 400」。
 * ⚠️ 只有 readJsonBody 自己造的错误才有 `isRequestError` ——
 *    调用方靠它区分「用户输入不对（该回 4xx）」和「程序出错了（该回 500）」。
 */
function requestError(status, error, message) {
  const err = new Error(message)
  err.status = status
  err.error = error
  err.isRequestError = true
  return err
}

/**
 * 把请求体读进来、解析成 JSON 对象。**三步都做，任一步失败就抛错。**
 *
 *   ① 读流（超过 64 KB → 413）
 *   ② 解析 JSON（不是合法 JSON → 400）
 *   ③ 确认是对象（数组 / null / 数字 → 400）
 *
 * 【为什么第 ③ 步也要拦】
 *   合法的 JSON 不等于我们要的东西。`[1,2,3]` 是合法 JSON，但它没有字段可读；
 *   后面 `body.name` 会得到 undefined，错误会跑到很远的地方才暴露。
 *   **在门口拦掉，比在里面猜要省事得多。**
 *
 * 【为什么单独抽这个函数】
 *   原来 `createFolder` 里内联了这三步（约 15 行）。
 *   现在多了 `updateFolder` 也要读请求体 —— 再抄一遍就会有两份
 *   「大小上限是多少、错误文案怎么写的」需要同步维护。
 *
 * @returns {Promise<object>} 解析好的请求体对象
 * @throws {Error} 带 status / error / message / isRequestError 的错误
 */
async function readJsonBody(req) {
  let raw
  try {
    raw = await readBody(req)
  } catch (err) {
    if (err.tooLarge) {
      throw requestError(413, 'PAYLOAD_TOO_LARGE', '提交的内容太大了')
    }
    throw err
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw requestError(400, 'BAD_REQUEST', '请求体不是合法的 JSON')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw requestError(400, 'BAD_REQUEST', '请求体必须是一个 JSON 对象')
  }

  return body
}

module.exports = { send, ok, fail, readBody, readJsonBody }
