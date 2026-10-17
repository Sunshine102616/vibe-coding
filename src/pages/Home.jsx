import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteFolder,
  fetchFolders,
  fetchMaterials,
  getLastUpdatedAt,
  renameFolder,
} from '../api.js'
import { ROUTES, practicePath } from '../useHashRoute.js'

const ALL_FOLDER = { id: 'all', name: '全部材料' }

function formatUpdatedAt(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('zh-CN', { hour12: false })
}

export default function Home() {
  const [status, setStatus] = useState('loading')
  const [folders, setFolders] = useState([])
  const [materials, setMaterials] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading')
    try {
      const [folderResult, materialResult] = await Promise.all([
        fetchFolders(),
        fetchMaterials(),
      ])
      setFolders(folderResult.folders || [])
      setMaterials(materialResult.materials || [])
      setUpdatedAt(getLastUpdatedAt())
      setErrorMessage('')
      setStatus('ready')
    } catch (error) {
      // 写入后的读取失败交给操作入口说明，不能继续显示“操作成功”。
      if (silent) throw error
      setErrorMessage(error.message)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (status === 'loading') return <LoadingView />
  if (status === 'error') return <ErrorView message={errorMessage} onRetry={() => load()} />

  return (
    <ReadyView
      folders={folders}
      materials={materials}
      updatedAt={updatedAt}
      onReload={() => load({ silent: true })}
    />
  )
}

function LibraryIntro() {
  return (
    <header className="library-intro">
      <div className="intro-copy">
        <p className="intro-kicker">给自己一点安静的学习时间</p>
        <h1>慢慢听，<br />大胆读。</h1>
        <p className="intro-description">选一段英语，听清一句，再跟着读一句。<br />按自己的节奏，慢慢来就好。</p>
      </div>
      <div className="intro-art" aria-hidden="true">
        <img src="/study-morning.png" alt="" width="1536" height="1024" fetchPriority="high" />
      </div>
    </header>
  )
}

function ReadyView({ folders, materials, updatedAt, onReload }) {
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const folderList = [ALL_FOLDER, ...folders]
  const selectedFolder = folderList.find((folder) => folder.id === selectedFolderId) || ALL_FOLDER
  const isFiltering = selectedFolder.id !== 'all'
  const visibleMaterials = isFiltering
    ? materials.filter((material) => material.folderId === selectedFolder.id)
    : materials
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]))

  return (
    <div className="page library-page">
      <LibraryIntro />
      <div className="library-layout">
        <FolderPanel
          folders={folderList}
          materials={materials}
          selectedId={selectedFolder.id}
          onSelect={setSelectedFolderId}
          onReload={onReload}
        />
        <MaterialPanel
          materials={visibleMaterials}
          folderName={selectedFolder.name}
          folderNameById={folderNameById}
          isFiltering={isFiltering}
          totalCount={materials.length}
          onClearFilter={() => setSelectedFolderId('all')}
        />
      </div>
      <footer className="library-footnote">
        <span>练习统计尚未提供</span>
        <span>最近读取：{formatUpdatedAt(updatedAt)}</span>
      </footer>
    </div>
  )
}

function FolderIcon({ all = false }) {
  return (
    <svg className="folder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {all ? (
        <>
          <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
          <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
          <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
          <rect x="14.5" y="14.5" width="6" height="6" rx="1" />
        </>
      ) : (
        <path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4h5L12 7h7.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V7Z" />
      )}
    </svg>
  )
}

function FolderPanel({ folders, materials, selectedId, onSelect, onReload }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [feedback, setFeedback] = useState(null)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [isWide, setIsWide] = useState(() => window.matchMedia('(min-width: 761px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px)')
    const update = () => setIsWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function selectFolder(id) {
    if (busyRef.current) return
    setRenamingId(null)
    setConfirmingId(null)
    setFeedback(null)
    onSelect(id)
  }

  function startRename(folder) {
    if (busyRef.current) return
    setFeedback(null)
    setConfirmingId(null)
    setRenamingId(folder.id)
    setRenameValue(folder.name)
  }

  function cancelRename() {
    if (busyRef.current) return
    setRenamingId(null)
    setRenameValue('')
    setFeedback(null)
  }

  async function submitRename(folder) {
    if (busyRef.current) return
    const next = renameValue.trim()
    if (!next) {
      setFeedback({ folderId: folder.id, kind: 'error', text: '文件夹名称不能为空，请填写后再保存。' })
      return
    }
    if (next === folder.name) {
      cancelRename()
      return
    }

    busyRef.current = true
    setBusy(true)
    setFeedback(null)
    let saved = false
    try {
      await renameFolder(folder.id, next)
      saved = true
      setRenamingId(null)
      setRenameValue('')
      await onReload()
      setFeedback({ folderId: folder.id, kind: 'ok', text: `已改名为「${next}」` })
    } catch (error) {
      setFeedback({
        folderId: folder.id,
        kind: 'error',
        text: saved
          ? `改名已保存，但列表刷新失败：${error.message}。请刷新页面查看最新结果。`
          : error.message,
      })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function submitDelete(folder) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFeedback(null)
    let saved = false
    try {
      await deleteFolder(folder.id)
      saved = true
      if (folder.id === selectedId) onSelect('all')
      setConfirmingId(null)
      await onReload()
      setFeedback({ folderId: folder.id, kind: 'ok', text: `已删除「${folder.name}」` })
    } catch (error) {
      setFeedback({
        folderId: folder.id,
        kind: 'error',
        text: saved
          ? `「${folder.name}」已删除，但列表刷新失败：${error.message}。请刷新页面查看最新结果。`
          : error.message,
      })
      setConfirmingId(null)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirmingFolder = folders.find((folder) => folder.id === confirmingId)
  const selectedFolder = folders.find((folder) => folder.id === selectedId)

  return (
    <aside className="folder-panel" aria-label="材料文件夹">
      <details className="folder-disclosure" open={isWide || foldersOpen}>
        <summary
          className="folder-summary"
          onClick={(event) => {
            event.preventDefault()
            if (!isWide) setFoldersOpen((open) => !open)
          }}
        >
          <span>文件夹 <span className="folder-summary-current">/ {selectedFolder?.name}</span></span>
          <span className="folder-summary-toggle" aria-hidden="true">{foldersOpen ? '−' : '+'}</span>
        </summary>
        <div className="folder-content">
          <div className="panel-heading">
            <h2>文件夹</h2>
            <a className="folder-create" href={ROUTES.new} aria-label="新建文件夹">＋</a>
          </div>
          <ul className="folder-list">
            {folders.map((folder) => {
              const count = folder.id === 'all'
                ? materials.length
                : materials.filter((material) => material.folderId === folder.id).length
              const active = folder.id === selectedId
              const invalid = feedback?.folderId === folder.id && feedback.kind === 'error'

              return (
                <li key={folder.id} className="folder-row">
                  {renamingId === folder.id ? (
                    <form className="folder-edit" onSubmit={(event) => { event.preventDefault(); submitRename(folder) }}>
                      <input
                        className="input folder-rename-input"
                        value={renameValue}
                        onChange={(event) => { setRenameValue(event.target.value); setFeedback(null) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && !event.nativeEvent.isComposing) cancelRename()
                          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
                        }}
                        aria-label={`把文件夹「${folder.name}」改成`}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'folder-feedback' : undefined}
                        disabled={busy}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
                        {busy ? '保存中……' : '保存'}
                      </button>
                      <button type="button" className="btn btn-small" disabled={busy} onClick={cancelRename}>取消</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`folder-item${active ? ' active' : ''}`}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => selectFolder(folder.id)}
                      >
                        <FolderIcon all={folder.id === 'all'} />
                        <span className="folder-name">{folder.name}</span>
                        <span className="folder-count">{count}</span>
                      </button>
                      {folder.id !== 'all' && active && (
                        <div className="folder-actions">
                          <button type="button" className="btn btn-small" disabled={busy} onClick={() => startRename(folder)}>改名</button>
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            disabled={busy}
                            onClick={() => { setFeedback(null); setRenamingId(null); setConfirmingId(folder.id) }}
                          >删除</button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {confirmingFolder && (
            <div className="confirm-strip">
              <p className="confirm-text">确定删除「{confirmingFolder.name}」？删除后无法恢复。</p>
              <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => submitDelete(confirmingFolder)}>
                {busy ? '删除中……' : '确定删除'}
              </button>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => setConfirmingId(null)}>取消</button>
            </div>
          )}
        </div>
      </details>
      {feedback && (
        <p
          id="folder-feedback"
          className={`field-msg folder-feedback ${feedback.kind === 'ok' ? 'msg-ok' : 'msg-error'}`}
          role={feedback.kind === 'ok' ? 'status' : 'alert'}
        >{feedback.text}</p>
      )}
      <div className="library-note">
        <p>不必一次读得完美。</p>
        <span>听一遍，读一遍，<br />再听听自己的声音。</span>
      </div>
    </aside>
  )
}

function MaterialPanel({ materials, folderName, folderNameById, isFiltering, totalCount, onClearFilter }) {
  return (
    <section className="material-panel" aria-labelledby="materials-heading">
      <div className="material-toolbar">
        <div>
          <h2 id="materials-heading">{folderName} <span className="material-count">{materials.length} 份</span></h2>
        </div>
        <a className="btn btn-primary" href={ROUTES.new}><span aria-hidden="true">＋</span> 新建材料</a>
      </div>
      {isFiltering && (
        <div className="filter-chip">
          <span>正在查看：{folderName}</span>
          <button type="button" className="filter-clear" onClick={onClearFilter} aria-label={`清除筛选，显示全部 ${totalCount} 条材料`}>清除筛选</button>
        </div>
      )}
      {materials.length === 0 ? (
        <div className="state-box empty-inline">
          <span className="state-symbol" aria-hidden="true">＋</span>
          <h3 className="state-title">{isFiltering ? '这个文件夹还没有材料' : '从第一份材料开始'}</h3>
          <p className="state-desc">
            {isFiltering ? `「${folderName}」里还没有材料，可以新建一份或查看其他文件夹。` : '添加音频和可选的英文文本，开启你的跟读练习。'}
          </p>
          <div className="empty-actions">
            <a className="btn btn-primary" href={ROUTES.new}>去新建材料</a>
            {isFiltering && (
              <button type="button" className="btn btn-ghost" onClick={onClearFilter}>查看全部材料（{totalCount}）</button>
            )}
          </div>
        </div>
      ) : (
        <ul className="material-list">
          {materials.map((material) => {
            const mode = material.audioUrl
              ? material.sentenceCount > 0 ? 'ready' : 'audio'
              : 'missing'
            const label = { ready: '逐句练习', audio: '整段播放', missing: '待补音频' }[mode]
            return (
              <li key={material.id} className="material-item">
                <a className="material-open" href={practicePath(material.id)}>
                  <span className="material-copy">
                    <span className="material-title">{material.title}</span>
                    <span className="material-meta">
                      <span>{folderNameById.get(material.folderId) || '所属文件夹暂不可用'}</span>
                      <span>{material.sentenceCount > 0 ? `${material.sentenceCount} 个句段` : '暂无句段'}</span>
                    </span>
                  </span>
                  <span className={`material-mode mode-${mode}`}>{label}</span>
                  <span className="material-arrow" aria-hidden="true">↗</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function LoadingView() {
  return (
    <div className="page library-page">
      <LibraryIntro />
      <section className="material-panel state-box" aria-busy="true" aria-label="材料库正在加载">
        <div className="skeleton-list" aria-hidden="true">
          <div className="skeleton-bar w60" />
          <div className="skeleton-bar w40" />
          <div className="skeleton-bar w60" />
        </div>
        <p className="state-desc" role="status">正在整理你的材料库……</p>
      </section>
    </div>
  )
}

function ErrorView({ message, onRetry }) {
  return (
    <div className="page library-page">
      <LibraryIntro />
      <section className="material-panel state-box state-error" role="alert">
        <span className="state-symbol" aria-hidden="true">!</span>
        <h2 className="state-title">材料库暂时没有打开</h2>
        <p className="state-desc">{message}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>重新读取</button>
      </section>
    </div>
  )
}
