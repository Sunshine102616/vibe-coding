// 首页（Day 7 骨架版）
// 界面依据 PRD 第三节：文件夹列表 + 材料列表 + 连续打卡天数。
// 列表里目前是写死的示例数据；等接上 IndexedDB 之后会换成真实数据。

const FOLDERS = ['全部材料', '课本音频', '听力训练', '未分类']

const MATERIALS = [
  { id: 1, title: 'Unit 1 Reading', folder: '课本音频', sentences: 12 },
  { id: 2, title: 'Unit 2 Listening', folder: '课本音频', sentences: 9 },
  { id: 3, title: 'VOA 慢速英语 0901', folder: '听力训练', sentences: 18 },
]

export default function Home({ onOpenMaterial, onGoNew }) {
  return (
    <div className="page">
      <section className="card stat-card">
        <div className="stat">
          <span className="stat-num">0</span>
          <span className="stat-label">连续打卡（天）</span>
        </div>
        <div className="stat">
          <span className="stat-num">0</span>
          <span className="stat-label">本月已练（天）</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>文件夹</h2>
          <button className="btn btn-ghost" onClick={onGoNew}>
            新建文件夹
          </button>
        </div>
        <ul className="folder-list">
          {FOLDERS.map((name, i) => (
            <li key={name} className={i === 0 ? 'folder-item active' : 'folder-item'}>
              <span>{name}</span>
              <span className="muted">
                {i === 0 ? MATERIALS.length : MATERIALS.filter((m) => m.folder === name).length}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>材料</h2>
          <button className="btn btn-primary" onClick={onGoNew}>
            新建材料
          </button>
        </div>
        <ul className="material-list">
          {MATERIALS.map((m) => (
            <li key={m.id} className="material-item">
              <button className="material-open" onClick={() => onOpenMaterial(m)}>
                <span className="material-title">{m.title}</span>
                <span className="muted">
                  所属：{m.folder}　句段：{m.sentences}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="notice">
        Day 7 骨架版：界面已就位，功能尚未接通（点材料可以跳到练习页看排版）。
      </p>
    </div>
  )
}
