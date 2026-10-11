// 前端调后端接口的统一入口（Day 19 追加② 新增）
//
// 【为什么要单独一个文件】
//   接口地址、请求方式、错误处理**只写一处** —— 组件里只管「我要什么数据」。
//   将来换地址（比如换成正式域名）只改这里，不用在页面里翻。
//
// 【接口返回的形状】
//   统一是 `{ ok, data, error, message, time }`（见 api-contract.md 1.4）。
//   成功看 `data`，失败看 `message`。
//   这个文件负责把「失败」**变成异常**，让调用方用 try/catch 一处处理，
//   不用每处都写 `if (body.ok)`。
//
// 【跨域说明】
//   前端在 localhost:5173，接口在 xxx.service.tcloudbase.com —— 是跨域。
//   CORS 响应头由**腾讯云网关**负责，云函数里没加（加了反而冲突，见
//   cloudfunctions/health/http-utils.js 的实测记录）。前端这边不用做任何事。

const BASE_URL = 'https://xingho-read-d0gamjt5d859dbd81.service.tcloudbase.com/api'

// ── 最近一次响应里带的服务器时间（加练 · Day 20）────────────────
//
// 契约 1.4 规定每个响应都带一个 `time` 字段（服务器生成响应那一刻的时间）。
// 平时它是「调试用的元信息」，用不上；**「最后更新时间」正好就是它** ——
// 界面上的数据是「什么时候从服务器取回来的」，这个字段就是最准的答案
// （比在前端用 new Date() 取本地时间准：本地时钟可能不准，而且异步请求有延迟）。
//
// 为什么用模块级变量而不是让 request() 返回整个 body：
//   `request()` 现在的契约是「成功返回 data」，调用方拿到的就是能直接用的数据。
//   为了一个附加信息把它改成 `{ data, time }`，会让**所有调用点都要改** ——
//   而真正需要 time 的只有一个地方。**不动主契约，另开一个小出口**，代价最小。
let lastUpdatedAt = null

/**
 * 取「数据最后更新时间」—— 最近一次接口响应里带的服务器时间（ISO 字符串）。
 * 还没成功请求过时返回 null。
 */
export function getLastUpdatedAt() {
  return lastUpdatedAt
}

/**
 * 发一个请求，并解开统一的响应格式。
 *
 * 成功 → 返回 `data` 部分
 * 失败 → 抛出带**中文提示**的 Error（调用方直接拿 message 显示给用户）
 *
 * @param {string} path     形如 '/folders'
 * @param {object} [options] fetch 的第二个参数（method / body / headers）
 */
async function request(path, options) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, options)
  } catch {
    // fetch 自己抛错 = 网络断了 / 地址不对 / 跨域被拦
    // ⚠️ 浏览器出于安全考虑**不给跨域失败的具体原因**，只能给一句笼统的话
    throw new Error('连不上服务器，请检查网络后重试')
  }

  let body
  try {
    body = await res.json()
  } catch {
    // 服务器回了非 JSON（比如网关自己的错误页）
    throw new Error(`服务器返回了意外的内容（HTTP ${res.status}）`)
  }

  if (!body.ok) {
    // 接口自己说失败了 —— message 已经是写好的中文，直接用
    throw new Error(body.message || `请求失败（HTTP ${res.status}）`)
  }

  // 记下服务器时间，供「最后更新时间」显示（加练 · Day 20）
  lastUpdatedAt = body.time || null

  return body.data
}

/**
 * 取文件夹列表。
 * 每个文件夹带 `count`（里面有几条材料）。
 * ⚠️ **不含「全部材料」** —— 那是界面上「看全部」的入口，不是真实文件夹，
 *    由页面自己加上（见 Home.jsx）。
 *
 * @returns {Promise<{folders: Array<{id,name,count,createdAt}>}>}
 */
export function fetchFolders() {
  return request('/folders')
}

/**
 * 取材料列表。
 * @param {object} [params]
 *   folderId  按文件夹筛选；不传或传 'all' = 取全部
 *   limit     最多几条（1–100）
 * @returns {Promise<{materials: Array<{id,title,folderId,audioUrl,sentenceCount,createdAt}>}>}
 */
export function fetchMaterials({ folderId, limit } = {}) {
  const qs = new URLSearchParams()
  if (folderId && folderId !== 'all') qs.set('folderId', folderId)
  if (limit) qs.set('limit', String(limit))

  const query = qs.toString()
  return request(`/materials${query ? `?${query}` : ''}`)
}

/**
 * 新建文件夹。
 * ⚠️ 首页用不到，是给新建页准备的（P1-2 还没接上）—— 先放在这里，
 *    接的时候不用再写一遍请求逻辑。
 *
 * @param {{id:string, name:string}} input
 * @returns {Promise<{folder: {id,name,count,createdAt}}>}
 */
export function createFolder({ id, name }) {
  return request('/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name }),
  })
}
