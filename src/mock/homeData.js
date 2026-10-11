// 本地假数据（mock）—— Day 8 板块③
//
// ⚠️⚠️ Day 20 起，**首页已经不用这个文件了**（首页改读真接口，见 pages/Home.jsx）。
//    现在还在用它的是：**练习页**（App.jsx 靠 findMaterialById 找材料标题）和
//    **新建页**（NewMaterial.jsx 靠 homeData.folders 判断文件夹重名）。
//    这两处接真接口之后，本文件即可整个删掉。对应待办 P1-3 / P1-5。
//
// 【为什么材料列表要照着数据库抄一份（Day 20）】
//   首页一改成真数据，就会出现一个**看着像 bug 的现象**：
//   数据库里 6 条材料（id 1–6），首页全列出来了；可练习页只认 mock 里的 3 条，
//   点「BBC 六分钟英语」（id 4）会显示「找不到这条材料」——
//   而这条材料明明就在，只是练习页还不知道。
//
//   两条路：① 现在就把练习页也接上真接口（属于下一步的活）；
//          ② 先把这个假数据**对齐成数据库的样子**，让 6 条都能点开。
//   选 ② —— 花 6 行、不留下一个明显错误的提示，等练习页真接上时再删本文件。
//
//   ⚠️ 代价要说清楚：**这里是手抄的，不会自动跟着数据库变**。
//      数据库改了材料名，这里不会跟着改。它就是个临时替身。

const homeData = {
  // 打卡统计
  streakDays: 0,
  monthDays: 0,

  // 文件夹：第一项「全部材料」不是真实文件夹，是「看全部」的入口，固定排第一
  folders: [
    { id: 'all', name: '全部材料' },
    { id: 'textbook', name: '课本音频' },
    { id: 'listening', name: '听力训练' },
    { id: 'unsorted', name: '未分类' },
  ],

  // 材料列表 —— ⚠️ 这是照着数据库抄的（Day 20），不是真实来源。
  // 内容对应 db/seed.sql 里的 6 条材料，字段名沿用本文件自己的写法
  // （`folder` 是名字、`sentences` 是句段数），因为练习页是按这个读的。
  // 真接口那边是 `folderId` / `sentenceCount` —— 练习页接上后本段整个删掉。
  materials: [
    { id: '1', title: 'Unit 1 Reading', folder: '课本音频', sentences: 6 },
    { id: '2', title: 'Unit 2 Listening', folder: '课本音频', sentences: 0 },
    { id: '3', title: 'VOA 慢速英语 0901', folder: '听力训练', sentences: 3 },
    { id: '4', title: 'BBC 六分钟英语', folder: '听力训练', sentences: 0 },
    { id: '5', title: '日常口语 100 句', folder: '口语跟读', sentences: 0 },
    { id: '6', title: '还没分类的素材', folder: '未分类', sentences: 0 },
  ],
}

// 按 id 找一条材料。找不到返回 null。
//
// Day 13 新增：练习页的地址带 id（#/practice/1），刷新或直接打开链接时，
// 界面要靠这个函数把材料**重新找回来**，而不是记住「刚才点进去的那个对象」。
//
// ⚠️ Day 20 起它是**同步**的（读本地数组），而真接口是异步的。
//    练习页接上真接口时，App.jsx 得改成「先 loading、再显示」的写法 ——
//    这一步和首页今天的改造是同一类活，所以留到练习页那天一起做。
export function findMaterialById(id) {
  if (id == null) return null
  return homeData.materials.find((m) => m.id === String(id)) || null
}

export default homeData
