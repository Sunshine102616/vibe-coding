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

module.exports = { send, ok, fail, readBody }
