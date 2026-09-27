// 首页 —— Day 8｜mock 数据版（板块①生成页面，板块③接假数据）
// Day 10｜修复：文件夹胶囊点了没反应 —— 补上点击与筛选
// Day 12｜用 Skill 自检后补齐筛选的三种情况（有结果 / 无结果 / 清空恢复）
//
// 生成依据就是 Day 8 清单里的那一句话；界面结构依据 PRD 第三节：
// 文件夹列表 + 材料列表 + 连续打卡天数。
//
// 本文件只做两件事：① 决定现在该显示哪种状态；② 把数据铺到界面上。
// 数据本身不在这里，在 src/mock/homeData.js。

import { useState } from 'react'
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
  // 当前选中的文件夹 id；'all' = 第一项「全部材料」
  const [selectedFolderId, setSelectedFolderId] = useState('all')

  const selectedFolder =
    data.folders.find((f) => f.id === selectedFolderId) || data.folders[0]

  // 是否处于「筛选状态」——选了「全部材料」不算筛选
  const isFiltering = selectedFolder.id !== 'all'

  // 「全部材料」看全部；其他文件夹按名字过滤
  const visibleMaterials = isFiltering
    ? data.materials.filter((m) => m.folder === selectedFolder.name)
    : data.materials

  // 「清除筛选」= 回到「全部材料」
  function clearFilter() {
    setSelectedFolderId('all')
  }

  return (
    <div className="page">
      <StatsCard streakDays={data.streakDays} monthDays={data.monthDays} />
      <FolderCard
        folders={data.folders}
        materials={data.materials}
        selectedId={selectedFolder.id}
        onSelect={setSelectedFolderId}
        onGoNew={onGoNew}
      />
      <MaterialCard
        materials={visibleMaterials}
        folderName={selectedFolder.name}
        isFiltering={isFiltering}
        totalCount={data.materials.length}
        onClearFilter={clearFilter}
        onOpenMaterial={onOpenMaterial}
        onGoNew={onGoNew}
      />

      <p className="notice">
        这里是示例数据，仅用于看界面效果；第 3 周接入真实数据后，就会显示你自己导入的材料。
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

// 文件夹列表卡片：点击切换当前文件夹
function FolderCard({ folders, materials, selectedId, onSelect, onGoNew }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>文件夹</h2>
        <button className="btn btn-ghost" onClick={onGoNew}>
          新建文件夹
        </button>
      </div>
      <ul className="folder-list">
        {folders.map((folder) => {
          const count =
            folder.id === 'all'
              ? materials.length
              : materials.filter((m) => m.folder === folder.name).length
          const active = folder.id === selectedId

          return (
            <li key={folder.id}>
              <button
                type="button"
                className={active ? 'folder-item active' : 'folder-item'}
                aria-pressed={active}
                onClick={() => onSelect(folder.id)}
              >
                <span>{folder.name}</span>
                <span className="muted">{count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// 材料列表卡片：只显示当前文件夹下的材料
//
// 三种情况（Day 12 用 Skill 自检后补齐）：
//   有结果  —— 正常列出
//   无结果  —— 说明原因 + 给「查看全部材料」按钮，不让用户卡在空页面上
//   清空恢复 —— 筛选生效时标题旁显示「筛选中」标识 + 「清除」入口
function MaterialCard({
  materials,
  folderName,
  isFiltering,
  totalCount,
  onClearFilter,
  onOpenMaterial,
  onGoNew,
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>材料</h2>
        {isFiltering && (
          <span className="filter-chip">
            筛选中：{folderName}
            <button
              type="button"
              className="filter-clear"
              onClick={onClearFilter}
              aria-label={`清除筛选，显示全部 ${totalCount} 条材料`}
            >
              清除
            </button>
          </span>
        )}
        <button className="btn btn-primary" onClick={onGoNew}>
          新建材料
        </button>
      </div>

      {materials.length === 0 ? (
        <div className="empty-inline">
          <p className="state-desc">「{folderName}」里还没有材料。</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-small" onClick={onGoNew}>
              往这里新建材料
            </button>
            <button type="button" className="btn btn-small" onClick={onClearFilter}>
              查看全部材料（{totalCount}）
            </button>
          </div>
        </div>
      ) : (
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
      )}
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
