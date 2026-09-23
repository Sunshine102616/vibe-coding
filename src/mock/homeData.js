// 首页的本地假数据（mock）—— Day 8 板块③
//
// 这个文件是「假数据的唯一来源」：首页只负责拿数据、渲染，不自己造数据。
// 第 3 周接 IndexedDB 时，要替换的就是这个文件（以及它变成「异步读取」的写法），
// 首页的结构不用动 —— 这就是把数据抽出来的意义。

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

  // 材料列表
  materials: [
    { id: 1, title: 'Unit 1 Reading', folder: '课本音频', sentences: 12 },
    { id: 2, title: 'Unit 2 Listening', folder: '课本音频', sentences: 9 },
    { id: 3, title: 'VOA 慢速英语 0901', folder: '听力训练', sentences: 18 },
  ],
}

export default homeData
