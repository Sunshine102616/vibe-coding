// 首页 —— Day 8｜mock 数据版（板块①生成页面，板块③接假数据）
//
// 生成依据就是 Day 8 清单里的那一句话；界面结构依据 PRD 第三节：
// 文件夹列表 + 材料列表 + 连续打卡天数。
//
// 本文件只做两件事：① 决定现在该显示哪种状态；② 把数据铺到界面上。
// 数据本身不在这里，在 src/mock/homeData.js。

import homeData from '../mock/homeData.js'

// ── 页面状态 ───────────────────────────────────────────
// 四种状态：loading 加载中 / empty 空 / error 错误 / ready 正常。
//
// 板块③：状态可以从地址栏指定，方便把另外三种状态逐个看一遍，例如
//     http://localhost:5173/?state=empty
// 不写、或写了不认识的值，就是正常的 ready。
// 这是临时的开发开关 —— 第 3 周接上真实数据后，这里改成「真读数据」，
// 状态由读取结果决定，这个 URL 参数就删掉。

const STATES = ['loading', 'empty', 'error', 'ready']

function readViewState() {
  const value = new URLSearchParams(window.location.search).get('state')
  return STATES.includes(value) ? value : 'ready'
}

export default function Home({ onOpenMaterial, onGoNew }) {
  const state = readViewState()

  if (state === 'loading') return <LoadingView />
  if (state === 'empty') return <EmptyView onGoNew={onGoNew} />
  if (state === 'error') return <ErrorView />
  return <ReadyView data={homeData} onOpenMaterial={onOpenMaterial} onGoNew={onGoNew} />
}

// ── 正常状态 ───────────────────────────────────────────

function ReadyView({ data, onOpenMaterial, onGoNew }) {
  return (
    <div className="page">
      <StatsCard streakDays={data.streakDays} monthDays={data.monthDays} />
      <FolderCard folders={data.folders} materials={data.materials} onGoNew={onGoNew} />
      <MaterialCard
        materials={data.materials}
        onOpenMaterial={onOpenMaterial}
        onGoNew={onGoNew}
      />

      <p className="notice">
        Day 8 mock 数据版：列表和卡片来自 src/mock/homeData.js 的本地假数据，尚未接 IndexedDB。
      </p>
    </div>
  )
}

// 打卡统计卡片
function StatsCard({ streakDays, monthDays }) {
  return (
    <section className="card stat-card">
      <div className="stat">
        <span className="stat-num">{streakDays}</span>
        <span className="stat-label">连续打卡（天）</span>
      </div>
      <div className="stat">
        <span className="stat-num">{monthDays}</span>
        <span className="stat-label">本月已练（天）</span>
      </div>
    </section>
  )
}

// 文件夹列表卡片
function FolderCard({ folders, materials, onGoNew }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>文件夹</h2>
        <button className="btn btn-ghost" onClick={onGoNew}>
          新建文件夹
        </button>
      </div>
      <ul className="folder-list">
        {folders.map((folder, i) => (
          <li key={folder.id} className={i === 0 ? 'folder-item active' : 'folder-item'}>
            <span>{folder.name}</span>
            <span className="muted">
              {i === 0
                ? materials.length
                : materials.filter((m) => m.folder === folder.name).length}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// 材料列表卡片
function MaterialCard({ materials, onOpenMaterial, onGoNew }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>材料</h2>
        <button className="btn btn-primary" onClick={onGoNew}>
          新建材料
        </button>
      </div>
      <ul className="material-list">
        {materials.map((m) => (
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
  )
}

// ── 加载中状态 ─────────────────────────────────────────
// 用几条灰色占位条表示「数据还在路上」，比只写「加载中」更像真页面。

function LoadingView() {
  return (
    <div className="page">
      <section className="card">
        <div className="card-head">
          <h2>材料</h2>
        </div>
        <div className="skeleton-list">
          <div className="skeleton-bar w60" />
          <div className="skeleton-bar w40" />
          <div className="skeleton-bar w60" />
        </div>
        <p className="state-desc">正在读取本地数据……</p>
      </section>
    </div>
  )
}

// ── 空状态 ─────────────────────────────────────────────
// 新用户第一次打开看到的就是这一屏，所以要给出「下一步做什么」。

function EmptyView({ onGoNew }) {
  return (
    <div className="page">
      <section className="card state-box">
        <p className="state-title">还没有任何材料</p>
        <p className="state-desc">新建一条材料，上传音频后就能开始逐句跟读。</p>
        <button className="btn btn-primary" onClick={onGoNew}>
          去新建材料
        </button>
      </section>
    </div>
  )
}

// ── 错误状态 ───────────────────────────────────────────
// 说清「哪一步失败了 + 怎么办」，不留一个点了没反应的按钮。

function ErrorView() {
  return (
    <div className="page">
      <section className="card state-box state-error">
        <p className="state-title">材料读取失败</p>
        <p className="state-desc">浏览器没能读出本地数据，请刷新页面重试。</p>
      </section>
    </div>
  )
}
