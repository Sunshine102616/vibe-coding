// 首页 —— Day 19 追加②｜接真实数据（从数据库读，不再用假数据）
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
//
// Day 27：文件夹补上「改名 / 删除」入口（P1-9）+ 删除二次确认（P1-10）。
//         接口早就有了（`PATCH|DELETE /api/folders/:id`），缺的一直是前端入口 ——
//         也就是说：**功能在，但用户摸不到**，和没有是一样的。
//         ⚠️ 删除失败（文件夹里还有材料）时，后端回 409 并带着**现查的条数**，
//            那句话前端编不出来 → 原样显示，不自己另写一句。

import { useCallback, useEffect, useState } from 'react'
import {
  deleteFolder,
  fetchFolders,
  fetchMaterials,
  getLastUpdatedAt,
  renameFolder,
} from '../api.js'
import { ROUTES, practicePath } from '../useHashRoute.js'

// 把服务器时间（ISO 字符串）显示成人看得懂的样子。
//
// ⚠️ 接口给的 time 是 **UTC**（结尾带 Z），`new Date()` 会按**浏览器所在时区**换算，
//    所以这里直接 toLocaleString 就是对的，不要自己去加 8 小时。
// 出错时返回 '—' 而不是 "Invalid Date" —— 界面上不该出现英文报错。
function formatUpdatedAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

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
  // 加练 · Day 20：数据最后更新时间（来自接口响应里的 time 字段）
  const [updatedAt, setUpdatedAt] = useState(null)

  // useCallback：把 load 函数本身固定下来，好让下面的 useEffect 只在首次挂载时跑一次。
  // 不包的话每次渲染都是新函数，effect 会反复触发 → 无限请求。
  //
  // 【`silent` 是干什么的】（Day 27）
  //   改名 / 删除成功之后要重新读一遍数据。但如果直接走 load()，
  //   它会先 `setStatus('loading')` → Home 渲染成 LoadingView →
  //   **ReadyView 整个卸载** → FolderCard 里的本地状态（「已改名为…」的提示、
  //   当前选中的文件夹）全部丢失。
  //   结果就是：操作成功了，页面却闪一下骨架屏、提示消失、选中被重置 ——
  //   用户完全看不到「我刚才那一下到底成没成」。
  //   所以「已经有数据时的刷新」用 silent：不切状态，读完直接替换数据。
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading')
    try {
      // 两个请求互不依赖，用 Promise.all 一起发，省掉一次来回等待
      const [folderResult, materialResult] = await Promise.all([
        fetchFolders(),
        fetchMaterials(),
      ])
      setFolders(folderResult.folders || [])
      setMaterials(materialResult.materials || [])
      // 两个请求都成功了才读时间 —— getLastUpdatedAt() 给的是「最近一次」响应的时间
      setUpdatedAt(getLastUpdatedAt())
      setStatus('ready')
    } catch (err) {
      // api.js 抛出来的 message 已经是写好的中文，直接拿来给用户看。
      // 不在这里猜原因（是断网？是服务器挂了？）—— 猜错了会把人带偏。
      //
      // ⚠️ silent 刷新失败也照样切到错误页：这时候手上的数据**可能是错的**
      //    （比如改名其实没生效），继续显示它等于说假话。宁可说「读取失败」。
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

  return (
    <ReadyView
      folders={folders}
      materials={materials}
      updatedAt={updatedAt}
      // silent：改名 / 删除后的刷新**不要**把页面切回加载中，
      // 否则正在显示的成功提示和当前选中都会丢（原因见上面 load 的注释）。
      onReload={() => load({ silent: true })}
    />
  )
}

// ── 正常状态 ───────────────────────────────────────────

function ReadyView({ folders, materials, updatedAt, onReload }) {
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
        onReload={onReload}
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

      {/* 加练 · Day 20：一个迷你「检查台」——
          把「接口通不通」和「这批数据是什么时候取的」摊开写在页面上。
          页面看着不对时，先看这一行：接口正常说明问题在前端，时间不对说明读到的是旧数据。
          ⚠️ 时间是**服务器**给的（接口响应里的 time），不是本地时钟 —— 本地时钟可能不准。 */}
      <p className="state-desc">
        云端接口正常　·　数据最后更新：{formatUpdatedAt(updatedAt)}（刷新页面会重新读取）
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

// 文件夹列表卡片：点击切换当前文件夹；选中的那个可以改名 / 删除（Day 27 · P1-9 / P1-10）
//
// 【为什么「改名 / 删除」只出现在**选中的**那一个上】
//   每个文件夹都挂两个按钮 → 一屏十几个按钮，看不出哪个是哪个（要先看名字再回头点按钮，
//   视线来回跳）。只给当前选中的那一个，目标就永远明确：**你在看哪个，就改哪个**。
//   代价是「必须先选中」—— 这一步本来就要做（选中 = 看这个文件夹的材料），不算多余。
//
// 【为什么「全部材料」没有这两个按钮】
//   它不是数据库里的真文件夹，是界面上的「看全部」入口（见 ALL_FOLDER 的说明）。
//   对它改名 / 删除都是无意义的 —— 按钮点了会报错，那比没有按钮更糟。
//
// 【为什么删除要二次确认】
//   删掉之后**没有撤销**（后端没有回收站）。一次误点就没了，
//   而文件夹里可能装着老师整理好的材料 —— 代价和「点错一下」完全不成比例。
function FolderCard({ folders, materials, selectedId, onSelect, onReload }) {
  // 正在改名的文件夹 id；null = 没有在改名
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  // 正在等确认删除的文件夹 id；null = 没有在确认
  const [confirmingId, setConfirmingId] = useState(null)
  // 有没有请求在路上（改名 / 删除）—— 用它禁用按钮，防止连点两次
  const [busy, setBusy] = useState(false)
  // 操作结果：{ folderId, kind: 'ok' | 'error', text }
  //
  // ⚠️ 为什么要带 `folderId`：提示要能**点名是哪个文件夹**。
  //    删「听力训练」被拒时，后端那句话里本来就有名字，但「已删除「X」」这句
  //    是前端写的 —— 不点名的话，用户得自己去列表里数哪个没了。
  //    （提示显示在列表正下方，位置紧挨着刚点的那一行，见 styles.css 的 .confirm-strip 注释。）
  const [feedback, setFeedback] = useState(null)

  function startRename(folder) {
    setFeedback(null)
    setConfirmingId(null)
    setRenamingId(folder.id)
    setRenameValue(folder.name)
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
  }

  async function submitRename(folder) {
    const next = renameValue.trim()
    // 没改、或改成空的 —— 直接当取消，不发请求（省一次必然失败的来回）
    if (next === '' || next === folder.name) {
      cancelRename()
      return
    }

    setBusy(true)
    try {
      await renameFolder(folder.id, next)
      cancelRename()
      // ⚠️ **先等列表刷新完，再显示「已改名为…」**。
      //    反过来的话，提示已经说「已改名为「新名字」」了，列表还挂着旧名字 ——
      //    界面自己和自己不一致（哪怕只有几百毫秒，用户也会看到）。
      //    onReload 是 silent 的，不会把页面切回加载中。
      await onReload()
      setFeedback({ folderId: folder.id, kind: 'ok', text: `已改名为「${next}」` })
    } catch (err) {
      // 后端的中文提示**原样显示**（可能是 409 重名、400 超长）。
      // 不在前端另编一句 —— 后端已经知道具体原因了，前端猜会猜错。
      setFeedback({ folderId: folder.id, kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitDelete(folder) {
    setBusy(true)
    try {
      await deleteFolder(folder.id)
      // 删掉的正好是当前选中的那个 → 退回「全部材料」。
      // 不退的话页面会停在一个已经不存在的文件夹上：标题写着它、列表是空的，
      // 看起来像「这个文件夹突然空了」—— 比报错更让人困惑。
      if (folder.id === selectedId) onSelect('all')
      setConfirmingId(null)
      // 同 submitRename：先刷新列表，再显示提示，避免界面自相矛盾
      await onReload()
      setFeedback({ folderId: folder.id, kind: 'ok', text: `已删除「${folder.name}」` })
    } catch (err) {
      // ⚠️ 文件夹里还有材料时后端回 **409**，message 形如
      //    「「听力训练」里还有 2 条材料，先把它们移走或删掉，再删这个文件夹」。
      //    那个 **2 是后端现查的**，前端编不出来 → 必须原样显示。
      setFeedback({ folderId: folder.id, kind: 'error', text: err.message })
      setConfirmingId(null)
    } finally {
      setBusy(false)
    }
  }

  // 反馈指向的那个文件夹（用来在文案里点名；可能已被删掉，所以允许 undefined）
  const feedbackFolder =
    feedback !== null ? folders.find((f) => f.id === feedback.folderId) : undefined
  // 正在确认删除的那个文件夹。
  // ⚠️ 找不到就不显示确认条 —— 不给「确定删除」按钮传 undefined，
  //    否则点下去会是一个前端自己抛的错，而不是后端说的话。
  const confirmingFolder =
    confirmingId !== null ? folders.find((f) => f.id === confirmingId) : undefined

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
          // 「全部材料」不是真文件夹，不能改名 / 删除
          const isRealFolder = folder.id !== 'all'

          return (
            <li key={folder.id} className="folder-row">
              {renamingId === folder.id ? (
                // ── 改名中：这一行变成「输入框 + 保存 / 取消」 ──
                <div className="folder-edit">
                  <input
                    className="input folder-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    // 键盘也能完成：Enter 保存、Esc 取消。
                    // 用键盘改名时不用把手从键盘移到鼠标上。
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(folder)
                      if (e.key === 'Escape') cancelRename()
                    }}
                    aria-label={`把文件夹「${folder.name}」改成`}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={busy || renameValue.trim() === ''}
                    onClick={() => submitRename(folder)}
                  >
                    {busy ? '保存中……' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={cancelRename}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={active ? 'folder-item active' : 'folder-item'}
                    aria-pressed={active}
                    onClick={() => onSelect(folder.id)}
                  >
                    <span>{folder.name}</span>
                    <span className="muted">{count}</span>
                  </button>

                  {isRealFolder && active && (
                    <span className="folder-actions">
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => startRename(folder)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={() => {
                          setFeedback(null)
                          setRenamingId(null)
                          setConfirmingId(folder.id)
                        }}
                      >
                        删除
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── 二次确认（P1-10）──
          说清「删的是哪个」和「删了会怎样」。不说后果的确认框
          只是让人多按一次，起不到拦一下的作用。
          放在列表下方而不是那一行里 —— 原因见 styles.css 的 .confirm-strip 注释。 */}
      {confirmingFolder && (
        <div className="confirm-strip">
          <span className="confirm-text">
            确定删除「{confirmingFolder.name}」？删除后无法恢复。
          </span>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => submitDelete(confirmingFolder)}
          >
            {busy ? '删除中……' : '确定删除'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setConfirmingId(null)}
          >
            取消
          </button>
        </div>
      )}

      {/* ── 操作结果 ──
          成功和失败都显示在**同一个位置**，用户不用猜「刚才那句在哪」。
          失败时显示的是**后端原话**（如「「听力训练」里还有 2 条材料…」）——
          那个条数是后端现查的，前端编不出来。 */}
      {feedback && (
        <p
          className={`field-msg folder-feedback ${
            feedback.kind === 'ok' ? 'msg-ok' : 'msg-error'
          }`}
        >
          {feedback.text}
          {feedback.kind === 'error' && !feedbackFolder ? '（这个文件夹已经不在了）' : ''}
        </p>
      )}
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
