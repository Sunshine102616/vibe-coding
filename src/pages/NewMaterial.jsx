import { useCallback, useEffect, useRef, useState } from 'react'
import { createFolder, createMaterial, fetchFolders } from '../api.js'
import { ROUTES, practicePath } from '../useHashRoute.js'

// Keep limits aligned with POST /api/materials and POST /api/folders.
const MAX_NAME_LENGTH = 30
const MAX_TITLE_LENGTH = 100
const MAX_AUDIO_URL_LENGTH = 500
const MAX_TEXT_LENGTH = 500
const MAX_SENTENCES = 500
const CHECK_DELAY = 400

function audioAddressError(value) {
  const url = value.trim()
  if (!url) return ''
  if (url.length > MAX_AUDIO_URL_LENGTH) return '音频地址最多 500 个字符'
  return /^https?:\/\//i.test(url) ? '' : '音频地址需要以 http:// 或 https:// 开头'
}

function useAudioDuration(value) {
  const url = value.trim()
  const [result, setResult] = useState({ url: '', status: 'idle', ms: null })
  useEffect(() => {
    if (!url || audioAddressError(url)) {
      setResult({ url, status: 'idle', ms: null })
      return
    }
    let cancelled = false
    let settled = false
    let timer
    const probe = new Audio()
    probe.preload = 'metadata'
    setResult({ url, status: 'reading', ms: null })

    const release = () => {
      probe.onloadedmetadata = null
      probe.onerror = null
      probe.removeAttribute('src')
      probe.load()
    }
    const finish = (ms) => {
      if (cancelled || settled) return
      settled = true
      clearTimeout(timer)
      const valid = Number.isSafeInteger(ms) && ms > 0
      setResult({ url, status: valid ? 'ok' : 'failed', ms: valid ? ms : null })
      release()
    }
    probe.onloadedmetadata = () => finish(Math.round(probe.duration * 1000))
    probe.onerror = () => finish(null)
    timer = setTimeout(() => finish(null), 8000)
    probe.src = url
    return () => {
      cancelled = true
      clearTimeout(timer)
      release()
    }
  }, [url])

  // A new address must never display or submit the previous address's duration.
  return result.url === url
    ? result
    : { url, status: url && !audioAddressError(url) ? 'reading' : 'idle', ms: null }
}

export default function NewMaterial() {
  const [folders, setFolders] = useState([])
  const [folderStatus, setFolderStatus] = useState('loading')
  const [foldersError, setFoldersError] = useState('')
  const requestRef = useRef(0)

  const loadFolders = useCallback(async () => {
    const request = ++requestRef.current
    setFolderStatus('loading')
    setFoldersError('')
    try {
      const data = await fetchFolders()
      if (request !== requestRef.current) return
      setFolders(data.folders || [])
      setFolderStatus('ready')
    } catch (error) {
      if (request !== requestRef.current) return
      setFoldersError(error.message)
      setFolderStatus('error')
    }
  }, [])

  useEffect(() => {
    loadFolders()
    return () => { requestRef.current += 1 }
  }, [loadFolders])

  function addFolder(folder) {
    setFolders((current) => [...current.filter((item) => item.id !== folder.id), folder])
  }

  return (
    <div className="page new-material-page">
      <header className="new-material-heading">
        <div>
          <h1>新建一份练习材料</h1>
          <p>收好一段声音，留给下一次认真开口。</p>
        </div>
        <a className="btn btn-ghost" href={ROUTES.home}>返回材料库</a>
      </header>
      <div className="new-material-layout">
        <MaterialForm
          folders={folders}
          folderStatus={folderStatus}
          foldersError={foldersError}
          onReloadFolders={loadFolders}
          onFolderCreated={addFolder}
        />
        <aside className="preparation-note" aria-label="准备材料的小提示">
          <img src="/study-morning.png" alt="" width="1536" height="1024" />
          <div className="preparation-copy">
            <h2>从一小段开始。</h2>
            <p>一段课文、一则短故事，<br />都是今天可以练习的声音。</p>
            <ul>
              <li><strong>音频</strong><span>粘贴可以访问的音频地址。</span></li>
              <li><strong>文本</strong><span>可选，一行一句，方便跟读。</span></li>
              <li><strong>练习</strong><span>保存后就能打开这份材料。</span></li>
            </ul>
            <p className="preparation-footnote">暂时没有文本也没关系，<br />有音频就可以先整段听。</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function MaterialForm({ folders, folderStatus, foldersError, onReloadFolders, onFolderCreated }) {
  const [folderId, setFolderId] = useState('')
  const [title, setTitle] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [text, setText] = useState('')
  const [manualSeconds, setManualSeconds] = useState('')
  const [saving, setSaving] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(null)
  const savingRef = useRef(false)
  const resultRef = useRef(null)
  const duration = useAudioDuration(audioUrl)

  useEffect(() => {
    if (folderStatus === 'ready' && !folders.some((folder) => folder.id === folderId)) {
      setFolderId(folders[0]?.id || '')
    }
  }, [folders, folderId, folderStatus])

  useEffect(() => {
    if (saved) resultRef.current?.focus()
  }, [saved])

  const titleError = title.trim().length > MAX_TITLE_LENGTH ? '材料标题最多 100 个字符' : ''
  const urlError = audioAddressError(audioUrl)
  const manualMs = Math.round(Number(manualSeconds) * 1000)
  const manualError = manualSeconds !== '' && (!Number.isSafeInteger(manualMs) || manualMs <= 0)
    ? '请填写大于 0 的有效秒数'
    : ''
  const effectiveDurationMs = duration.status === 'ok'
    ? duration.ms
    : duration.status === 'failed' && manualSeconds !== '' && !manualError ? manualMs : null
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const tooLongLine = lines.findIndex((line) => line.length > MAX_TEXT_LENGTH)
  const textError = lines.length > MAX_SENTENCES
    ? '一条材料最多 500 个句段，请减少文本行数'
    : tooLongLine !== -1
      ? '第 ' + (tooLongLine + 1) + ' 行最多 500 个字符，请拆成更短的句子'
      : effectiveDurationMs !== null && lines.length > effectiveDurationMs
        ? '音频时长太短，无法为每行文本生成有效句段，请检查时长'
        : ''
  const willCreateSentences = lines.length > 0 && effectiveDurationMs !== null && !textError
  const validFolder = folderStatus === 'ready' && folders.some((folder) => folder.id === folderId)
  const canSave = !saving && !creatingFolder && title.trim() !== '' && validFolder &&
    !titleError && !urlError && !manualError && !textError
  const omittedText = lines.length > 0 && !willCreateSentences

  function changeAudio(event) {
    setAudioUrl(event.target.value)
    setManualSeconds('')
    setSaveError('')
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!canSave || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    setSaved(null)
    try {
      // Preserve the existing uniform timing method; it is explicitly approximate.
      const each = willCreateSentences ? Math.floor(effectiveDurationMs / lines.length) : 0
      const sentences = willCreateSentences
        ? lines.map((line, index) => ({
            no: index + 1,
            text: line,
            startMs: index * each,
            endMs: index === lines.length - 1 ? effectiveDurationMs : (index + 1) * each,
          }))
        : []
      const data = await createMaterial({
        title: title.trim(),
        folderId,
        audioUrl: audioUrl.trim() || null,
        sentences,
      })
      setSaved({ material: data.material, sentenceCount: sentences.length, omittedText })
      setTitle('')
      setAudioUrl('')
      setText('')
      setManualSeconds('')
    } catch (error) {
      setSaveError(error.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  let saveHint = '保存后，可以继续添加或直接去练习。'
  if (folderStatus !== 'ready') saveHint = '读取文件夹成功后才能保存。'
  else if (!validFolder) saveHint = '先创建并选择一个文件夹。'
  else if (!title.trim()) saveHint = '给材料起个标题，就可以保存了。'
  else if (titleError || urlError || manualError || textError) saveHint = '请先修正上面标出的内容。'
  else if (creatingFolder) saveHint = '正在创建文件夹，请稍等。'
  else if (omittedText) saveHint = '尚无有效时长：本次只保存标题和音频，已填文本不会保存。'

  return (
    <form className="material-form" onSubmit={handleSave} noValidate aria-label="新建材料" aria-busy={saving}>
      <fieldset className="form-section" disabled={saving}>
        <legend>音频与标题</legend>
        <p className="section-description">先准备声音，再给它一个容易找到的名字。</p>
        <div className="field">
          <label htmlFor="audio-url">音频地址 <span className="field-optional">可选</span></label>
          <input id="audio-url" className={'input' + (urlError ? ' input-invalid' : '')}
            type="url" inputMode="url" placeholder="https://…/audio/lesson-1.mp3"
            value={audioUrl} onChange={changeAudio} aria-invalid={Boolean(urlError)}
            aria-describedby="audio-help audio-feedback" />
          <p className="hint" id="audio-help">粘贴已上传音频的完整地址。不填时可以先保存标题，暂时不能播放。</p>
          <div id="audio-feedback">
            {urlError ? <p className="field-msg msg-error" role="alert">{urlError}</p> : (
              <DurationStatus duration={duration} manualSeconds={manualSeconds}
                manualError={manualError} onManualChange={(value) => { setManualSeconds(value); setSaveError('') }} />
            )}
          </div>
          <details className="upload-help">
            <summary>音频地址从哪里来？</summary>
            <p>把音频上传到网站的音频目录，再粘贴完整地址。也可以使用能正常访问的音频外链。</p>
            <p>已有音频文件时，在项目目录的命令行执行：</p>
            <code>tcb hosting deploy "音频.mp3" audio/文件名.mp3</code>
            <p>上传后，地址格式为：</p>
            <code>https://xingho-read-d0gamjt5d859dbd81-1497420413.tcloudbaseapp.com/audio/文件名.mp3</code>
          </details>
        </div>
        <div className="field">
          <div className="field-label-row">
            <label htmlFor="title">材料标题 <span className="field-required">必填</span></label>
            <span className="character-count">{title.trim().length} / {MAX_TITLE_LENGTH}</span>
          </div>
          <input id="title" className={'input' + (titleError ? ' input-invalid' : '')}
            placeholder="例如：Lesson 1 · A new beginning" value={title}
            onChange={(event) => { setTitle(event.target.value); setSaveError('') }}
            required aria-invalid={Boolean(titleError)} aria-describedby={titleError ? 'title-error' : undefined} />
          {titleError && <p className="field-msg msg-error" id="title-error" role="alert">{titleError}</p>}
        </div>
      </fieldset>

      <fieldset className="form-section" disabled={saving}>
        <legend>放进文件夹</legend>
        <p className="section-description">按课本或主题归类，下次练习时更好找。</p>
        <div className="field">
          <label htmlFor="folder-select">所属文件夹 <span className="field-required">必填</span></label>
          {folderStatus === 'loading' ? (
            <div className="folder-load-state" role="status">正在读取文件夹……</div>
          ) : folderStatus === 'error' ? (
            <div className="form-inline-error">
              <p className="field-msg msg-error" role="alert">读取文件夹失败：{foldersError}</p>
              <button type="button" className="btn btn-small" onClick={onReloadFolders}>重新读取文件夹</button>
            </div>
          ) : folders.length === 0 ? (
            <p className="folder-load-state">还没有文件夹，在下面创建一个就好。</p>
          ) : (
            <select id="folder-select" className="input" value={folderId}
              onChange={(event) => { setFolderId(event.target.value); setSaveError('') }} required disabled={creatingFolder}>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          )}
        </div>
        <NewFolderField folders={folders} unavailable={folderStatus !== 'ready'} disabled={saving}
          onBusyChange={setCreatingFolder} onCreated={(folder) => { onFolderCreated(folder); setFolderId(folder.id) }} />
      </fieldset>

      <fieldset className="form-section" disabled={saving}>
        <legend>英文文本 <span className="field-optional">可选</span></legend>
        <p className="section-description">有文本时，每行填写一句。不填也能保存音频材料。</p>
        <div className="field">
          <label htmlFor="text" className="text-label">对应的英文内容</label>
          <textarea id="text" className={'input textarea' + (textError ? ' input-invalid' : '')}
            rows={6} placeholder={'一行一句，例如：\nLearning a language takes time.\nSmall steps every day add up.'}
            value={text} onChange={(event) => { setText(event.target.value); setSaveError('') }}
            aria-invalid={Boolean(textError)} aria-describedby="sentence-preview" />
          <div id="sentence-preview">
            {textError ? <p className="field-msg msg-error" role="alert">{textError}</p>
              : willCreateSentences ? (
                <div className="sentence-preview" role="status">
                  <p>将生成 <strong>{lines.length} 个句段</strong></p>
                  <p>每句时间按总时长平均分配，是近似值，不是按真实停顿切分。</p>
                </div>
              ) : omittedText ? (
                <p className="field-msg msg-warn" role="status">已填 {lines.length} 行文本，但还没有有效音频时长。
                  这样保存<strong>不会保存文本，也不会生成句段</strong>。请先补充音频地址或时长。</p>
              ) : <p className="hint">不填文本时，保存后可整段播放已有音频。</p>}
          </div>
        </div>
      </fieldset>

      <div className="material-save-area">
        <div className="material-save-row">
          <p className={'save-hint' + (omittedText ? ' msg-warn' : '')} id="save-hint">{saveHint}</p>
          <button type="submit" className="btn btn-primary" disabled={!canSave} aria-describedby="save-hint">
            {saving ? '保存中……' : '保存材料'}
          </button>
        </div>
        {saveError && <p className="field-msg msg-error save-error" role="alert">保存失败：{saveError}。已填写的内容仍保留在这里。</p>}
        {saved && (
          <div className="save-success" role="status" tabIndex={-1} ref={resultRef}>
            <strong>已保存「{saved.material.title}」</strong>
            <p>{saved.sentenceCount > 0 ? saved.sentenceCount + ' 个句段，已准备好跟读。'
              : saved.material.audioUrl ? '暂未生成句段，可以先整段播放。' : '标题已保存，当前没有音频，暂时不能播放。'}</p>
            {saved.omittedText && <p>本次未保存英文文本，原因是保存时没有有效音频时长。</p>}
            <a className="btn btn-small" href={practicePath(saved.material.id)}>打开这份材料</a>
          </div>
        )}
      </div>
    </form>
  )
}

function DurationStatus({ duration, manualSeconds, manualError, onManualChange }) {
  if (duration.status === 'idle') return null
  if (duration.status === 'reading') return <p className="field-msg duration-reading" role="status">正在读取音频时长……</p>
  if (duration.status === 'ok') {
    const seconds = Math.round(duration.ms / 1000)
    const clock = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
    return <p className="field-msg msg-ok" role="status">已读到音频时长 {clock}（{seconds} 秒）</p>
  }
  return (
    <div className="duration-fallback">
      <p className="field-msg msg-error" role="alert">没能读到音频时长。请检查地址是否能打开，或手动填写总时长。</p>
      <label htmlFor="manual-seconds">手动填写时长 <span className="field-optional">秒</span></label>
      <input id="manual-seconds" className={'input' + (manualError ? ' input-invalid' : '')}
        type="number" min="0.001" step="any" placeholder="例如：120"
        value={manualSeconds} onChange={(event) => onManualChange(event.target.value)}
        aria-invalid={Boolean(manualError)} aria-describedby="manual-help" />
      <p className={'hint' + (manualError ? ' msg-error' : '')} id="manual-help">
        {manualError || '手动时长只用于分配句段时间，不能让失效的音频地址恢复播放。'}
      </p>
    </div>
  )
}

function NewFolderField({ folders, unavailable, disabled, onBusyChange, onCreated }) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [checkedName, setCheckedName] = useState(null)
  const [created, setCreated] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const busyRef = useRef(false)
  const trimmed = name.trim()

  useEffect(() => {
    if (!trimmed || unavailable) {
      setCheckedName(null)
      return
    }
    const timer = setTimeout(() => setCheckedName(trimmed), CHECK_DELAY)
    return () => clearTimeout(timer)
  }, [name, trimmed, unavailable])

  const checked = trimmed && checkedName === trimmed && !unavailable
  const nameError = checked
    ? trimmed.length > MAX_NAME_LENGTH ? '名字最多 30 个字符，现在有 ' + trimmed.length + ' 个'
      : folders.some((folder) => folder.name === trimmed) ? '已有同名文件夹，请换一个名字' : ''
    : ''
  const canCreate = Boolean(checked && !nameError && !creating && !disabled)
  const needsFirstFolder = !unavailable && folders.length === 0
  const showFields = expanded || needsFirstFolder

  async function handleCreate() {
    if (!canCreate || busyRef.current) return
    busyRef.current = true
    setCreating(true)
    onBusyChange(true)
    setCreateError('')
    setCreated('')
    try {
      const data = await createFolder({
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: trimmed,
      })
      onCreated(data.folder)
      setCreated(data.folder.name)
      setName('')
      setCheckedName(null)
    } catch (error) {
      setCreateError(error.message)
    } finally {
      busyRef.current = false
      setCreating(false)
      onBusyChange(false)
    }
  }

  return (
    <div className="new-folder-inline">
      {needsFirstFolder ? <p className="hint">创建第一个文件夹</p> : (
        <button type="button" className="new-folder-toggle" aria-expanded={showFields}
          aria-controls="new-folder-fields" disabled={disabled || creating || unavailable}
          onClick={() => setExpanded((open) => !open)}>
          {showFields ? '收起新建文件夹' : '＋ 新建一个文件夹'}
        </button>
      )}
      {showFields && (
        <div id="new-folder-fields" className="new-folder-fields">
          <label htmlFor="new-folder">文件夹名称</label>
          <div className="row">
            <input id="new-folder" className={'input' + (nameError ? ' input-invalid' : '')}
              placeholder="例如：我的课本" value={name} disabled={disabled || creating || unavailable}
              onChange={(event) => { setName(event.target.value); setCheckedName(null); setCreated(''); setCreateError('') }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (!event.nativeEvent.isComposing) handleCreate()
                }
              }}
              aria-invalid={Boolean(nameError)} aria-describedby="new-folder-feedback" />
            <button type="button" className="btn btn-small" disabled={!canCreate} onClick={handleCreate}>
              {creating ? '创建中……' : '创建文件夹'}
            </button>
          </div>
          <p className={'field-msg' + (nameError ? ' msg-error' : '')} id="new-folder-feedback" aria-live="polite">
            {unavailable ? '读取文件夹列表后才能检查名称。' : nameError || (checked ? '这个名称可以使用。' : trimmed ? '正在检查名称……' : '最多 30 个字符。')}
          </p>
        </div>
      )}
      {createError && <p className="field-msg msg-error" role="alert">创建失败：{createError}</p>}
      {created && <p className="field-msg msg-ok" role="status">已创建「{created}」，并已选中。</p>}
    </div>
  )
}
