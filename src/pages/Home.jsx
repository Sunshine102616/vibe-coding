// 首页 —— Day 20｜接真实数据（从数据库读，不再用假数据）
//
// 【今天改了什么】
//   以前：`import homeData from '../mock/homeData.js'`，数据是写死在文件里的。
//   现在：`import { fetchFolders, fetchMaterials } from '../api.js'`，
//         打开页面时去问后端要，后端再去问数据库。
//
// 【为什么必须改成「异步」】
//   读文件是**立刻**就有结果，读网络要**等**。
//   等的过程里页面该显示什么？等失败了又显示什么？
//   所以「四态」不再是靠地址栏假装出来的，而是**读取结果自然产生的**：
//     一开始       → loading（正在读）
//     读回来了有货 → ready（正常显示）
//     读回来了没货 → empty（空状态）
//     读失败了     → error（说清原因 + 给重试）
//
// 【`?state=` 那个临时开关去哪了】
//   删了。它当初的存在意义就是「真实状态还没实现，先假装一下」。
//   现在状态是真的了，再留着反而会让人分不清「看到的到底是不是真的」。
//   想手动看那两种状态怎么办：
//     加载中 → 浏览器开发者工具 → Network → 调成 Slow 3G，刷新
//     失败   → 断开网络后刷新（或把 api.js 里的 BASE_URL 改成一个不存在的地址）
//
// 【界面结构没变】依旧依据 PRD 第三节：文件夹列表 + 材料列表 + 连续打卡天数。

import { useCallback, useEffect, useState } from 'react'
import { fetchFolders, fetchMaterials } from '../api.js'
import { ROUTES, practicePath } from '../useHashRoute.js'

// 「全部材料」不是数据库里的真实文件夹，是界面上的「看全部」入口。
// 接口**不会**返回它（契约 2.2），所以由页面自己造一个，固定排第一。
const ALL_FOLDER = { id: 'all', name: '全部材料' }

export default function Home() {
  // status 只有三种：'loading' | 'error' | 'ready'
  // 'empty' 不单独占一格 —— 它是「ready 但没数据」，由下面的数据长度判断出来。
  // 少一个状态变量，就少一处「状态和数据显示得不一样」的机会。
  const [status, setStatus] = useState('loading')
  const [folders, setFolders] = useState([])
  const [materials, setMaterials] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  // useCallback：把 load 函数本身固定下来，好让下面的 useEffect 只在首次挂载时跑一次。
  // 不包的话每次渲染都是新函数，effect 会反复触发 → 无限请求。
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      // 两个请求互不依赖，用 Promise.all 一起发，省掉一次来回等待
      const [folderResult, materialResult] = await Promise.all([
        fetchFolders(),
        fetchMaterials(),
      ])
      setFolders(folderResult.folders || [])
      setMaterials(materialResult.materials || [])
      setStatus('ready')
    } catch (err) {
      // api.js 抛出来的 message 已经是写好的中文，直接拿来给用户看。
      // 不在这里猜原因（是断网？是服务器挂了？）—— 猜错了会把人带偏。
      setErrorMessage(err.message)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (status === 'loading') return <LoadingView />
  if (status === 'error') return <ErrorView message={errorMessage} onRetry={load} />

  // 一个文件夹都没有、一条材料都没有 —— 这才是真的「新用户第一次打开」。
  // ⚠️ 只是某个文件夹里没材料，不算空状态：那时应该让用户看到文件夹列表，
  //    知道「东西在别的文件夹里」，而不是一屏「还没有任何材料」。
  if (folders.length === 0 && materials.length === 0) return <EmptyView />

  return <ReadyView folders={folders} materials={materials} />
}

// ── 正常状态 ───────────────────────────────────────────

function ReadyView({ folders, materials }) {
  // 当前选中的文件夹 id；'all' = 第一项「全部材料」
  const [selectedFolderId, setSelectedFolderId] = useState('all')

  // 接口返回的是真文件夹，前面补上「全部材料」这个入口。
  // 顺序：全部材料 → 数据库里的文件夹（按 created_at 排好序的，见 repo.js）。
  const folderList = [ALL_FOLDER, ...folders]

  const selectedFolder =
    folderList.find((f) => f.id === selectedFolderId) || ALL_FOLDER

  // 是否处于「筛选状态」——选了「全部材料」不算筛选
  const isFiltering = selectedFolder.id !== 'all'

  // 材料已经全部拿在手里了，切换文件夹就**不用再请求一次** —— 立刻出结果，不闪加载中。
  // ⚠️ 这里按 `folderId` 比对，**不是按文件夹名字**。
  //    名字可以重复、可以改名；id 不会。这是 Day 18 记进 api-contract 3.1 的结论。
  const visibleMaterials = isFiltering
    ? materials.filter((m) => m.folderId === selectedFolder.id)
    : materials

  // 材料列表里要显示「所属：课本音频」这样的中文名，但材料身上只有 folderId。
  // 用一张 Map 查名字，比每次渲染都去 folders 数组里 find 一遍快，
  // 也顺手处理了「文件夹被删了、材料还在」的情况（查不到就退回显示 id）。
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]))

  // 「清除筛选」= 回到「全部材料」
  function clearFilter() {
    setSelectedFolderId('all')
  }

  return (
    <div className="page">
      <StatsCard />
      <FolderCard
        folders={folderList}
        materials={materials}
        selectedId={selectedFolder.id}
        onSelect={setSelectedFolderId}
      />
      <MaterialCard
        materials={visibleMaterials}
        folderName={selectedFolder.name}
        folderNameById={folderNameById}
        isFiltering={isFiltering}
        totalCount={materials.length}
        onClearFilter={clearFilter}
      />

      {/* 说清「哪些是真的、哪些还不是」——
          含糊的说明等于没有说明，用户会自己猜，而且通常猜错（Day 14 的教训）。 */}
      <p className="notice">
        文件夹和材料已经是从数据库读出来的真实数据。打卡统计还没接后端，先固定显示 0。
      </p>
    </div>
  )
}

// 打卡统计卡片
//
// ⚠️ 目前是写死的 0，**没有接口**（后端还没有打卡记录表）。
//    之所以还留着这张卡片：它是首页结构的一部分，删掉会让布局看起来像出了 bug。
//    接入时机见待办清单（等有了练习记录表再说）。
function StatsCard() {
  return (
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
  )
}

// 文件夹列表卡片：点击切换当前文件夹
function FolderCard({ folders, materials, selectedId, onSelect }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>文件夹</h2>
        <a className="btn btn-ghost" href={ROUTES.new}>
          新建文件夹
        </a>
      </div>
      <ul className="folder-list">
        {folders.map((folder) => {
          // 数量**自己数**，不用接口给的 `count`。
          // 为什么：材料已经全在手里了，自己数出来的数和下面列表里实际显示的行数
          // **永远一致**。用接口的 count 就多一个「万一两边不一致」的可能，
          // 而用户一眼就能看出「写着 2 条，点进去只有 1 条」。
          // （将来改成按文件夹分页拉取时，才需要改回用接口的 count。）
          const count =
            folder.id === 'all'
              ? materials.length
              : materials.filter((m) => m.folderId === folder.id).length
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
  folderNameById,
  isFiltering,
  totalCount,
  onClearFilter,
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
        <a className="btn btn-primary" href={ROUTES.new}>
          新建材料
        </a>
      </div>

      {materials.length === 0 ? (
        <div className="empty-inline">
          <p className="state-desc">「{folderName}」里还没有材料。</p>
          <div className="empty-actions">
            <a className="btn btn-small" href={ROUTES.new}>
              往这里新建材料
            </a>
            {/* 全部材料也空的时候，这个按钮点了跟没点一样 —— 干脆不给，
                免得用户点了没反应又自己找理由（Day 14 实测的「沉默的失败」）。 */}
            {totalCount > 0 && (
              <button type="button" className="btn btn-small" onClick={onClearFilter}>
                查看全部材料（{totalCount}）
              </button>
            )}
          </div>
        </div>
      ) : (
        <ul className="material-list">
          {materials.map((m) => (
            <li key={m.id} className="material-item">
              {/* Day 13：改成 <a href="#/practice/1"> —— 打开材料变成一次真实导航，
                  地址栏会变、刷新能恢复、可以右键复制链接。 */}
              <a className="material-open" href={practicePath(m.id)}>
                <span className="material-title">{m.title}</span>
                <span className="muted">
                  所属：{folderNameById.get(m.folderId) || m.folderId}　句段：
                  {m.sentenceCount > 0 ? `${m.sentenceCount} 句` : '暂无'}
                </span>
              </a>
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
        <p className="state-desc">正在读取数据……</p>
      </section>
    </div>
  )
}

// ── 空状态 ─────────────────────────────────────────────
// 新用户第一次打开看到的就是这一屏，所以要给出「下一步做什么」。

function EmptyView() {
  return (
    <div className="page">
      <section className="card state-box">
        <p className="state-title">还没有任何材料</p>
        <p className="state-desc">新建一条材料，上传音频后就能开始逐句跟读。</p>
        <a className="btn btn-primary" href={ROUTES.new}>
          去新建材料
        </a>
      </section>
    </div>
  )
}

// ── 错误状态 ───────────────────────────────────────────
//
// 说清「哪一步失败了 + 为什么 + 怎么办」，不留一个点了没反应的按钮。
//
// ⚠️ 这里**不写死原因**：断网、服务器挂了、接口改了地址，都会走到这一屏，
//    但它们要用户做的事不一样。所以直接把 api.js 给的那句话显示出来，
//    再给一个「重新读取」——大多数情况（网络抖了一下）点一下就好了。

function ErrorView({ message, onRetry }) {
  return (
    <div className="page">
      <section className="card state-box state-error">
        <p className="state-title">数据读取失败</p>
        <p className="state-desc">{message}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          重新读取
        </button>
      </section>
    </div>
  )
}
