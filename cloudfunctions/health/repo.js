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

const { select, insert, update, remove, count } = require('./db')

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

/**
 * 改一个文件夹的名字（Day 22 新增）。
 *
 * 【为什么不改 id】
 *   id 是主键，也是**所有材料关联文件夹的依据**（materials.folder_id → folders.id）。
 *   改 id 等于把关联打断 —— 要么材料变成孤儿，要么得连带改一堆行。
 *   所以「改名」只改 name 这一列。**这是个设计决定，不是偷懒。**
 *
 * 【为什么返回 null 而不是抛错】
 *   查不到这个 id 时，db.update 会回一个**空数组**。
 *   这里把它翻译成 `null` —— 意思是「没这条」。
 *   ⚠️ 接口层要把它变成 **404**，不能当成「改成功了」。
 *   这一层不碰 HTTP（分层原则），所以不能在这里写 404。
 *
 * @param {{id:string, name:string}} input
 * @returns {Promise<object|null>} 改好后的文件夹；没有这个 id 时返回 null
 */
async function updateFolder({ id, name }) {
  const rows = await update('folders', { id }, { name })

  if (rows.length === 0) return null

  const row = rows[0]

  // 字段形状和 listFolders / createFolder 保持一致（契约 3.5）：
  // 前端拿到任何一个 folder 对象，解析方式都一样，不用为「改名」写第二套。
  return {
    id: row.id,
    name: row.name,
    count: await countMaterialsInFolder(id),
    createdAt: row.created_at,
  }
}

/**
 * 数一个文件夹里有几条材料。
 *
 * 【为什么单独抽出来】
 *   PATCH（改名后回填 count）和 DELETE（判断能不能删）都要用。
 *   写两遍就会出现「两处算法不一致」的可能。
 *
 * ⚠️ 和 listFolders 一样：PostgREST 不支持 GROUP BY，
 *    所以只能让数据库自己数（`count=exact`），而不是把材料全取回来在内存里数。
 */
function countMaterialsInFolder(folderId) {
  return count('materials', { folder_id: folderId })
}

/**
 * 删一个文件夹（Day 22 新增）。
 *
 * 【★ 为什么是「先试着删，被拦了再解释」—— 这是今天最关键的一个决定】
 *
 * 直觉写法是「先数一下里面有没有材料，有就不删」。**但那是应用层自己当裁判**：
 * 数完到删之间，别人可能刚插进去一条材料 —— 两个请求一起通过检查，这就是**竞态条件**。
 * （Day 18 的 `POST /api/folders` 防重复提交时踩过同样的坑，结论一样。）
 *
 * 所以这里**直接删，让数据库拦**：
 *   `materials.folder_id` 指向 `folders.id`，而且**故意没加 ON DELETE CASCADE**
 *   （见 `db/schema.sql` 的注释）→ 有材料的文件夹，**数据库根本不让删**。
 *   被拦下来（SQLSTATE **23503** 外键冲突）之后，我们**才**去数「有几条」——
 *   那个数字**只用来写提示语**，不参与「删不删」的决定。
 *
 * ⚠️ 顺序不能反：**先让数据库裁决，再补说明。** 反过来就是「应用层自己判断能不能删」，
 *    看似更聪明，实际在并发下会出错。
 *
 * 【为什么返回结果对象，而不是抛错】
 *   「没这条」和「里面有材料」都是**预期内的结果**，不是异常。
 *   这一层不碰 HTTP（分层原则），所以用 `{ deleted, reason }` 表达，
 *   由接口层翻译成 404 / 409。
 *
 * @param {string} id
 * @returns {Promise<
 *   { deleted: true,  folder: {id,name} }
 * | { deleted: false, reason: 'not-found' }
 * | { deleted: false, reason: 'has-materials', name: string, materialCount: number }
 * >}
 */
async function deleteFolder(id) {
  try {
    const rows = await remove('folders', { id })

    // 0 行 = 本来就没有这个 id（不是「删成功了」）
    if (rows.length === 0) return { deleted: false, reason: 'not-found' }

    return { deleted: true, folder: { id: rows[0].id, name: rows[0].name } }
  } catch (err) {
    // 23503 = foreign_key_violation = 这个文件夹里还有材料，数据库不让删
    if (err.code === '23503') {
      // 到这一步才去取「名字」和「有几条」—— 纯粹为了把提示语说清楚。
      // 两个查询互不依赖，并发发出去省一次来回。
      const [nameRows, materialCount] = await Promise.all([
        select('folders', { select: 'name', filter: { id } }),
        countMaterialsInFolder(id),
      ])

      return {
        deleted: false,
        reason: 'has-materials',
        name: nameRows.length > 0 ? nameRows[0].name : id,
        materialCount,
      }
    }

    // 其它错误（连不上、没权限…）不是预期结果 → 抛出去，交给上层兜底 500
    throw err
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

module.exports = {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  countMaterialsInFolder,
  listMaterials,
}
