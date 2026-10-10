// ============================================================
// 数据库访问（db.js）—— HTTP API 版
// ============================================================
//
// 【这个文件做什么】
//   把「查数据库」这件事收成两个函数，给接口层（index.js）用：
//     select(table, params)      查一张表，返回行数组
//     count(table, filter)       数一张表有多少行
//
// 【为什么不是直连数据库】
//   Day 17 一开始写的是 pg 直连（自己的连接池 + SQL 语句）。
//   部署前在控制台发现：本项目用的是**共享集群**，
//   共享集群**不提供外网地址**（控制台原话：「可升级至独享集群后启用」）。
//   云函数是跑在外面的，没有外网地址就够不着数据库 —— 直连方案作废。
//
//   改用 CloudBase 官方给的 **HTTP API**（底层是 PostgREST）：
//       云函数 --HTTPS--> CloudBase 网关 --内部--> 数据库
//   好处：不用管连接、不用管 SSL、不装任何依赖（只用 Node 内置模块）。
//
// ────────────────────────────────────────────────────────────
// 【地址怎么拼】
//   https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{表名}
//
//   ⚠️ 只能访问 public schema 的表 —— 官方限制，正好我们的表都在 public。
//
// 【认证：为什么要一个 Key】
//   网关不认「匿名请求」。必须带
//       Authorization: Bearer <API Key>
//   Key 属于**密钥**，按 AGENTS.md 第五条：不能写进代码、不能提交。
//   所以它从**环境变量**读（CLOUDBASE_API_KEY），
//   在云函数「配置 → 环境变量」里配。
//
// 【换方案的代价（诚实记录）】
//   1. 查询能力变弱：不再是「写 SQL」，而是「拼查询参数」。
//      SQL 里能做的复杂 JOIN / GROUP BY，这里做不了（PostgREST 的参数有限）。
//   2. 所以 sentenceCount 的算法要改 —— 见 index.js 的说明。
//   3. 好处是更安全：没有字符串拼接，天然不存在 SQL 注入。
// ============================================================

const https = require('https')

// 环境 ID（非密钥，写死没关系）
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xingho-read-d0gamjt5d859dbd81'

// API Key（**密钥**，必须来自环境变量，不许写死）
const API_KEY = process.env.CLOUDBASE_API_KEY

// 网关域名
const HOST = `${ENV_ID}.api.tcloudbasegateway.com`

// ── 底层：发一个 HTTPS GET ──────────────────────────────────

/**
 * 向 CloudBase HTTP API 发一个 GET 请求。
 *
 * @param {string} path 形如 `/v1/rdb/rest/materials`（可带查询串）
 * @returns {Promise<Array>} 解析后的 JSON 数组
 *
 * 为什么不用 fetch：云函数跑在 Node 20，fetch 是有的，
 * 但这里保留 https 模块是为了**自己控制超时**（fetch 的超时控制要额外写 AbortController）。
 */
function request(path) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      // 早失败、给一句人能看懂的话，不要等网关返回 401 再猜
      reject(new Error('缺少环境变量 CLOUDBASE_API_KEY，请先在云函数配置里添加'))
      return
    }

    const req = https.request(
      {
        host: HOST,
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: 'application/json',
        },
        timeout: 8000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(body)
          } catch {
            // 网关出错时可能回 HTML（比如网关自身 502），不是 JSON
            reject(new Error(`接口返回的不是 JSON（HTTP ${res.statusCode}）：${body.slice(0, 200)}`))
            return
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            // PostgREST 的错误体形如 { code, message, details, hint }
            const msg = json.message || json.error || JSON.stringify(json)
            reject(new Error(`HTTP ${res.statusCode}：${msg}`))
            return
          }

          resolve(json)
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error('请求 CloudBase HTTP API 超时（8 秒）'))
    })
    req.on('error', reject)
    req.end()
  })
}

// ── 对外：查一张表 ──────────────────────────────────────────

/**
 * 查表。把「查询参数」拼成 URL 的查询串 —— 这就是 PostgREST 的全部用法。
 *
 * @param {string} table   表名（public schema 下）
 * @param {object} options
 *   select  string  要哪些列，如 'id,title'（默认全部 *）
 *   filter  object  等值过滤，如 { folder_id: 'textbook' } → folder_id=eq.textbook
 *   order   string  排序，如 'created_at.asc'
 *   limit   number  最多几条
 * @returns {Promise<Array>}
 */
async function select(table, options = {}) {
  const { select: cols = '*', filter = {}, order, limit } = options

  const qs = new URLSearchParams()
  qs.set('select', cols)

  // PostgREST 的过滤写法是「列名=操作符.值」，等值就是 eq
  // URLSearchParams 会自动做百分号编码，中文/特殊字符不用自己处理
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue
    qs.set(key, `eq.${value}`)
  }

  if (order) qs.set('order', order)
  if (limit) qs.set('limit', String(limit))

  // ⚠️ 表名用 encodeURIComponent —— 表名虽然是我们写死的，
  //    但养成习惯：凡是拼进 URL 的外部片段都编码
  const rows = await request(`/v1/rdb/rest/${encodeURIComponent(table)}?${qs.toString()}`)

  // 契约要求返回数组。PostgREST 单条/多条都回数组，这里只是保险
  return Array.isArray(rows) ? rows : []
}

// ── 对外：数一行数 ──────────────────────────────────────────

/**
 * 数一张表符合条件的行数。
 *
 * 用的是 PostgREST 的 `count=exact`：
 *   请求头带 Prefer: count=exact，响应头会给 Content-Range: 0-0/6
 *   斜杠后面那个数就是总数。
 *
 * 为什么不用「把行都取回来再数」：那样数据一多就慢且费流量。
 *
 * @param {string} table
 * @param {object} filter 等值过滤，同 select
 * @returns {Promise<number>}
 */
async function count(table, filter = {}) {
  const qs = new URLSearchParams()
  qs.set('select', 'id')  // 只要一列，省流量

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue
    qs.set(key, `eq.${value}`)
  }

  // 只要第一行就够（我们要的是计数，不是数据）
  qs.set('limit', '1')

  const { rows } = await requestWithHeaders(
    `/v1/rdb/rest/${encodeURIComponent(table)}?${qs.toString()}`
  )

  // Content-Range: 0-0/6  →  取 '/' 后面的总数
  const range = rows.header('content-range') || ''
  const total = Number(range.split('/')[1])

  return Number.isFinite(total) ? total : 0
}

/** count() 专用：这次除了 body，还要拿到响应头 */
function requestWithHeaders(path) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      reject(new Error('缺少环境变量 CLOUDBASE_API_KEY，请先在云函数配置里添加'))
      return
    }

    const req = https.request(
      {
        host: HOST,
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: 'application/json',
          Prefer: 'count=exact',
        },
        timeout: 8000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}：${body.slice(0, 200)}`))
            return
          }
          resolve({ rows: { header: (name) => res.headers[name] } })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error('请求 CloudBase HTTP API 超时（8 秒）'))
    })
    req.on('error', reject)
    req.end()
  })
}

module.exports = { select, count, request }
