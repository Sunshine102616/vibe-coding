// ============================================================
// 数据库访问（db.js）—— HTTP API 版
// ============================================================
//
// 【这个文件做什么】
//   把「读写数据库」收成三个函数，给**数据访问层（repo.js）**用：
//     select(table, options)   查一张表，返回行数组
//     insert(table, row)       往表里插一行，返回插进去的那行
//     count(table, filter)     数一张表有多少行
//
//   ⚠️ 它是**最底下那层**：只懂「怎么跟数据库说话」，不懂业务。
//      这个文件里不该出现「文件夹」「句段数」这类词 ——
//      那些属于 repo.js。（Day 19 分层重构，见 index.js 头部说明）
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
//   它从**环境变量**读（CLOUDBASE_API_KEY）。
//
//   ⚠️⚠️ **环境变量必须用 CLI 推送，不要用控制台手填**（Day 18 血泪教训）：
//   控制台手填 1178 字符的 Key 会**静默丢失** —— 控制台显示成功、
//   `tcb fn detail` 也读得到，**但函数运行时 process.env 里没有它**。
//   用下面这条推送则完整到达：
//     printf '\n' | tcb config update fn health --config-file cloudbaserc.local.json --json
//
// 【换方案的代价（诚实记录）】
//   1. 查询能力变弱：不再是「写 SQL」，而是「拼查询参数」。
//      SQL 里能做的复杂 JOIN / GROUP BY，这里做不了（PostgREST 的参数有限）。
//   2. 所以 sentenceCount 的算法要改 —— 见 repo.js 里 listMaterials 的说明。
//   3. 好处是更安全：没有字符串拼接，天然不存在 SQL 注入。
// ============================================================

const https = require('https')

// 环境 ID（非密钥，写死没关系）
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xingho-read-d0gamjt5d859dbd81'

// API Key（**密钥**，必须来自环境变量，不许写死）
const API_KEY = process.env.CLOUDBASE_API_KEY

// 网关域名
const HOST = `${ENV_ID}.api.tcloudbasegateway.com`

// 请求超时（毫秒）。云函数自身超时 10 秒，这里留出余量。
const TIMEOUT = 8000

// ── 底层：发一个 HTTPS 请求 ──────────────────────────────────

/**
 * 向 CloudBase HTTP API 发请求。这是**唯一的出口**，三个对外函数都走它。
 *
 * @param {object} opts
 *   method  string  'GET' | 'POST' | ...
 *   path    string  形如 `/v1/rdb/rest/materials`（可带查询串）
 *   body    object  要发的 JSON（可选）
 *   prefer  string  Prefer 请求头（可选，如 'count=exact'）
 * @returns {Promise<{status:number, headers:object, json:any}>}
 *   失败时 **reject 一个带 status 的 Error**，调用方可以据此分辨
 *   「重复了（409）」还是「真出错了（500）」。
 */
function request({ method = 'GET', path, body, prefer }) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      // 早失败、给一句人能看懂的话，不要等网关返回 401 再猜
      reject(new Error('缺少环境变量 CLOUDBASE_API_KEY，请先在云函数配置里添加'))
      return
    }

    const payload = body === undefined ? null : JSON.stringify(body)

    const headers = {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    }
    if (prefer) headers.Prefer = prefer
    if (payload !== null) {
      headers['Content-Type'] = 'application/json'
      // 按**字节**算长度（中文一个占 3 字节）
      headers['Content-Length'] = Buffer.byteLength(payload)
    }

    const req = https.request(
      { host: HOST, path, method, headers, timeout: TIMEOUT },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => {
          let json = null
          if (text) {
            try {
              json = JSON.parse(text)
            } catch {
              // 网关自己出错时可能回 HTML（比如 502），不是 JSON
              reject(new Error(`接口返回的不是 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`))
              return
            }
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            // PostgREST 的错误体形如 { code, message, details, hint }
            // code 是 PostgreSQL 的 SQLSTATE，如 23505 = 唯一约束冲突
            const detail = (json && (json.message || json.error)) || text.slice(0, 200)
            const err = new Error(`HTTP ${res.statusCode}：${detail}`)
            err.status = res.statusCode
            err.code = json && json.code
            err.body = json
            reject(err)
            return
          }

          resolve({ status: res.statusCode, headers: res.headers, json })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error(`请求 CloudBase HTTP API 超时（${TIMEOUT} 毫秒）`))
    })
    req.on('error', reject)

    if (payload !== null) req.write(payload)
    req.end()
  })
}

// ── 对外 1：查一张表 ────────────────────────────────────────

/**
 * 查表。把「查询参数」拼成 URL 的查询串 —— 这就是 PostgREST 的全部用法。
 *
 * @param {string} table   表名（public schema 下）
 * @param {object} options
 *   select  string  要哪些列，如 'id,title'（默认全部 *）
 *   filter  object  等值过滤，如 { folder_id: 'textbook' } → folder_id=eq.textbook
 *   order   string  排序，如 'created_at.asc,id.asc'
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
  const { json } = await request({
    path: `/v1/rdb/rest/${encodeURIComponent(table)}?${qs.toString()}`,
  })

  // 契约要求返回数组。PostgREST 单条/多条都回数组，这里只是保险
  return Array.isArray(json) ? json : []
}

// ── 对外 2：往表里插一行（Day 18 新增）──────────────────────

/**
 * 插一行，并把**数据库写入后的真实结果**返回。
 *
 * @param {string} table
 * @param {object} row   形如 { id: 'test1', name: '测试文件夹' }
 * @returns {Promise<object>} 插入后的那一行（含数据库生成的 created_at）
 *
 * 【为什么要带 Prefer: return=representation】
 *   默认情况下 PostgREST 的写操作**只回状态码、不回数据体**。
 *   加这个头才会把插入后的行返回给我们 —— 这样 `created_at`
 *   （数据库用 DEFAULT now() 生成的）就能直接读到，
 *   不用再发一次查询去取。
 *
 * 【重复插入会怎样】
 *   表的主键约束会拒绝，网关返回 HTTP 409。
 *   这里**原样抛出**（Error 上带 status=409），由 index.js 翻译成人话。
 *   ⚠️ 这正是我们防重复提交的方式：**交给数据库裁判，不自己先查后插**。
 */
async function insert(table, row) {
  const { json } = await request({
    method: 'POST',
    path: `/v1/rdb/rest/${encodeURIComponent(table)}`,
    body: row,
    prefer: 'return=representation',
  })

  // PostgREST 返回数组（批量插入时是多条），我们只插一条，取第一条
  return Array.isArray(json) ? json[0] : json
}

// ── 对外 3：数一张表有多少行 ────────────────────────────────

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

  const { headers } = await request({
    path: `/v1/rdb/rest/${encodeURIComponent(table)}?${qs.toString()}`,
    prefer: 'count=exact',
  })

  // Content-Range: 0-0/6  →  取 '/' 后面的总数
  const range = headers['content-range'] || ''
  const total = Number(range.split('/')[1])

  return Number.isFinite(total) ? total : 0
}

module.exports = { select, insert, count, request }
