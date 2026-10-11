// ============================================================
// 数据访问层（repo.js）—— Day 19 新增
// ============================================================
//
// 【这一层做什么】
//   按「业务」取数据：文件夹列表、材料列表、新建文件夹。
//   它知道表结构、知道业务规则（比如「文件夹要带材料数」），
//   但**不知道 HTTP** —— 这个文件里不该出现 req / res / 状态码。
//
// 【它和 db.js 的分工（容易混，说清楚）】
//     db.js    通用表操作：select / insert / count  —— 不认识业务
//     repo.js  业务数据操作：listFolders / ...       —— 认识业务
//
//   这样分的好处：
//     换数据库方案（比如将来能直连了）→ 只改 db.js
//     换表结构（比如加一列）          → 只改 repo.js
//     接口层（index.js）两边都不受影响。
//
// 【为什么返回的是「接口形状」而不是「数据库行」】
//   数据库列名是 snake_case（folder_id / created_at），
//   接口契约要求 camelCase（folderId / createdAt）。
//   这个转换就放在这里 —— 于是 index.js 再也见不到数据库列名了。
//
// 【一个遗留的技术债】
//   db.js 里还导出了 count()，目前没人用（Day 18 分页才会用到）。
//   它留在 db.js 里是因为「怎么数总数」属于数据库客户端的知识
//   （响应头 Content-Range 的解析），不属于业务。
// ============================================================

const { select, insert } = require('./db')

// ── 文件夹 ───────────────────────────────────────────────────

/**
 * 取全部文件夹，每个带上「里面有几条材料」。
 *
 * 【为什么发两次请求】
 *   HTTP API（PostgREST）不支持 JOIN / GROUP BY，所以只能：
 *     ① 取全部文件夹
 *     ② 取全部材料的 folder_id（只要一列，省流量）
 *     ③ 在服务器内存里数一遍
 *   数据量小（5 个文件夹 / 6 条材料）时这样最省事；
 *   材料涨到几百条要改成在数据库里建视图（已记进待办清单）。
 *
 * 【为什么排序要加 id 做次序键】
 *   seed 数据里 5 个文件夹的 created_at **完全相同**，
 *   只按 created_at 排序时数据库返回的顺序**不保证** ——
 *   实测带 limit 的查询会返回 2、1 这种乱序。
 *   加上 id.asc 之后顺序才是确定的。（Day 18 修的）
 *
 * @returns {Promise<Array<{id,name,count,createdAt}>>}
 */
async function listFolders() {
  const [folders, materials] = await Promise.all([
    select('folders', { select: 'id,name,created_at', order: 'created_at.asc,id.asc' }),
    select('materials', { select: 'folder_id' }),
  ])

  // 先把材料按文件夹分组数好，避免对每个文件夹都扫一遍数组
  const countByFolder = new Map()
  for (const m of materials) {
    countByFolder.set(m.folder_id, (countByFolder.get(m.folder_id) || 0) + 1)
  }

  // 列名转换：数据库 created_at → 接口 createdAt（契约 3.1）
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    count: countByFolder.get(f.id) || 0,
    createdAt: f.created_at,
  }))
}

/**
 * 新建一个文件夹。
 *
 * 【重复提交会怎样】
 *   表的主键约束会拒绝，db.js 会把网关的 409 原样抛出来
 *   （Error 上带 status=409）。**这里不处理它** ——
 *   「409 该给用户看什么话」是接口层的事（index.js 翻译成中文）。
 *
 *   ⚠️ 这正是我们防重复提交的方式：**交给数据库裁判，不自己先查后插**。
 *      先查后插在并发下会一起通过检查、一起插入（竞态条件）。
 *
 * @param {{id:string, name:string}} input
 * @returns {Promise<{id,name,count,createdAt}>}
 */
async function createFolder({ id, name }) {
  const row = await insert('folders', { id, name })

  return {
    id: row.id,
    name: row.name,
    count: 0,                   // 新文件夹里当然没有材料
    createdAt: row.created_at,  // 数据库用 DEFAULT now() 生成，从插入结果里读回来
  }
}

// ── 材料 ─────────────────────────────────────────────────────

/**
 * 取材料列表，每条带上「有几个句段」。
 *
 * @param {object} options
 *   folderId  string  按文件夹筛选；不传或传 'all' = 取全部
 *   limit     number  最多几条（**已由接口层校验过**，这里不再校验）
 * @returns {Promise<Array<{id,title,folderId,audioUrl,sentenceCount,createdAt}>>}
 *
 * 【为什么还要再取一次 sentences】
 *   和文件夹那个一样 —— 不能 JOIN，只能取回来在内存里数。
 *   ⚠️ 注意：**没有句段的材料也要出现**（句段数 0）。
 *      所以 sentences 取回来是空的时候，材料本身照样返回。
 */
async function listMaterials({ folderId, limit } = {}) {
  const materials = await select('materials', {
    select: 'id,title,folder_id,audio_url,created_at',
    // filter 里放空对象表示不筛，db.js 会自动跳过
    filter: folderId && folderId !== 'all' ? { folder_id: folderId } : {},
    order: 'created_at.asc,id.asc',
    limit,
  })

  // 一次取回全部句段的 material_id，在内存里分组
  const sentences = await select('sentences', { select: 'material_id' })
  const sentenceCountByMaterial = new Map()
  for (const s of sentences) {
    sentenceCountByMaterial.set(
      s.material_id,
      (sentenceCountByMaterial.get(s.material_id) || 0) + 1
    )
  }

  return materials.map((m) => ({
    id: m.id,
    title: m.title,
    folderId: m.folder_id,
    audioUrl: m.audio_url,
    sentenceCount: sentenceCountByMaterial.get(m.id) || 0,
    createdAt: m.created_at,
  }))
}

module.exports = { listFolders, createFolder, listMaterials }
