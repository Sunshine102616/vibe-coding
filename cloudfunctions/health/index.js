/**
 * 云函数：health（健康检查）—— Web 函数版本
 *
 * 【这个函数做什么】
 * 它不做任何业务。访问它，它回一句 JSON，告诉外面「服务器活着」。
 * 它是本项目第一个跑在云上的代码 —— 用来证明整条链路是通的：
 *     公网访问 → CloudBase 网关 → 云函数 → 返回 JSON
 *
 * 【为什么先做这个】
 * 第 3 周后面所有接口（材料列表、保存材料……）都比它复杂得多。
 * 如果直接写复杂接口，失败了分不清是「云没配好」还是「我代码写错了」。
 * 先用最简单的一个跑通，把「云」这一层的不确定性一次性排除掉。
 *
 * 【今天它不做什么】
 * 不连数据库、不读环境变量、不校验身份。这些是 Day 16 以后的事。
 *
 * ───────────────────────────────────────────────────────────────
 * 【为什么是这个写法（重要，Day 15 踩过坑）】
 *
 * 云函数有两种类型，写法完全不同：
 *
 *   1. 事件型：exports.main = (event) => {...}
 *      平台帮你听请求，听完把 event 塞进来。你不碰网络层。
 *
 *   2. Web 函数：自己起一个 HTTP 服务监听端口。
 *      推荐用平台给的启动脚本 scf_bootstrap：
 *          export PORT=9000
 *          /var/lang/node20/bin/node index.js
 *      它执行本文件，本文件必须自己 listen 到 PORT 上。
 *
 * 本项目用第 2 种。原因：第 3 周要写十几个接口（列表 / 保存 / 修改 / 删除），
 * Web 函数能按 req.url 干净地分发路由；事件型则要手写一长串
 * if (event.path === '/api/xxx') 判断，接口一多就乱。
 *
 * ⚠️ 关键：PORT 必须从 process.env.PORT 读，不能写死 9000。
 * 平台可能改端口，写死的话部署到别的环境就起不来了。
 */

const http = require('http')

// 平台通过环境变量注入端口；本地调试时兜底用 9000
const PORT = process.env.PORT || 9000

/**
 * 根据请求路径分发处理。
 * 现在只有 /api/health 一个路由；Day 16 起会在这里往表里加。
 *
 * @param {string} pathname 请求路径，如 '/api/health'
 * @param {http.ServerResponse} res
 * @returns {boolean} 是否已处理该路径（false 表示没匹配上，交给调用方返回 404）
 */
function route(pathname, res) {
  // ── 健康检查 ──────────────────────────────────────────────
  //
  // 【为什么判断两个路径（Day 15 实测踩出来的）】
  // cloudbaserc.json 里配了 gatewayPath: "/api/health"。
  // 腾讯云网关会把这个前缀**从传给函数的路径里减掉**，实测：
  //     外部请求 /api/health       → 函数收到 "/"
  //     外部请求 /api/health/test  → 函数收到 "/test"
  // 所以函数内部看到的不是 "/api/health"，而是 "/"。
  //
  // 这里两个都认：
  //   '/'            —— 线上经过网关的真实情况
  //   '/api/health'  —— 本地直连调试时用（本地没有网关帮你剥前缀）
  // 这样本地和线上跑同一份代码都能通过，调试时不用改来改去。
  if (pathname === '/' || pathname === '/api/health') {
    // 字段说明：
    //   ok       —— 固定的成功标记，前端靠它判断服务是否正常
    //   service  —— 服务名，将来接口多了，一眼看出是哪个服务回的
    //   time     —— 服务器当前时间（ISO 格式）。它证明这次响应是服务器现算的，
    //               不是某个缓存里翻出来的旧结果（刷新页面能看到它在变）
    const payload = {
      ok: true,
      service: 'xingho-read',
      time: new Date().toISOString(),
    }

    const body = JSON.stringify(payload)

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      // 内容长度按字节算：中文等多字节字符下，字符串长度 ≠ 字节数，
      // 所以用 Buffer.byteLength 而不是 body.length
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
    return true
  }

  // 没匹配上的路由，交给调用方
  return false
}

// ── 启动 HTTP 服务 ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // req.url 可能带查询串（如 /api/health?t=1），用 URL 解析掉，
  // 只取路径部分做路由判断，避免 ?t=1 导致匹配失败
  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname

  // 先交给路由表
  if (route(pathname, res)) return

  // 没匹配上：返回 JSON 格式的 404（保持和正常响应同一种内容类型，
  // 前端处理错误时不用区分两套解析逻辑）
  const body = JSON.stringify({
    ok: false,
    error: 'NOT_FOUND',
    message: `没有这个接口：${pathname}`,
  })

  res.writeHead(404, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
})

server.listen(PORT, () => {
  // 这行会出现在云函数的日志里，方便确认服务是否真的起来了
  console.log(`[health] 服务已启动，监听端口 ${PORT}`)
})

// ── 兜底：未捕获异常不要让进程静默死掉 ──────────────────────────
// 进程一旦退出，云端不会自动重启，表现就是「网站突然打不开」且没有任何提示。
// 这里至少把原因打进日志，方便排查。
process.on('uncaughtException', (err) => {
  console.error('[health] 未捕获异常：', err)
})
