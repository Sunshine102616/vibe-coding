// 新建页
//
// Day 7  骨架版
// Day 11 给「② 新建文件夹」加输入即时校验与结果提示
// Day 24 修 Bug D —— 校验只查重名、不查长度，输入 5000 字符也会说「这个名字可以用」
// Day 27 **接真数据**（P1-2 / P1-4 / P1-5 / P1-11 / P1-1）：
//        下拉读真文件夹、判重读真库、新建文件夹真写入、材料真保存
//
// 【Day 27 修掉的两类「假成功」】
//   ① **Bug D2（P1-11）**：判重名单原来来自 `mock/homeData.js` 的 **3 个**文件夹，
//      真库有 **5 个** —— 输入「新闻英语」「口语跟读」会被误判成「可以用」，
//      真提交时被后端 409 拒。现在判重名单来自 `GET /api/folders`。
//   ② **下拉选项写死 3 个**（P1-5）：同理，现在读真库。
//
// 【音频为什么是「粘贴地址」而不是「选文件」】
//   已实测：本环境**没有云存储桶**（`tcb storage buckets list` → No buckets），
//   静态托管桶也不能用存储 API 上传（STORAGE_BUCKET_NOT_FOUND）。
//   唯一验证可行的路径是**命令行上传到静态托管**：
//       tcb hosting deploy "音频.mp3" audio/材料名.mp3
//   传完得到 https://…tcloudbaseapp.com/audio/材料名.mp3，粘到这里。
//   ⚠️ 所以「选择本地文件」这个入口**去掉了** —— 留着它就是个点了没用的按钮
//      （Day 14 的「沉默的失败」）。改成明确的「粘贴音频地址」+ 说明怎么拿到地址。

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createFolder,
  createMaterial,
  fetchFolders,
} from '../api.js'
import { ROUTES } from '../useHashRoute.js'

// 文件夹名字的最大长度。
// ⚠️ 这个数字**不是自己定的**，必须和后端 `cloudfunctions/health/index.js` 的
//    `if (name.length > 30)` 保持一致。
//    两边不一致就会产生「假成功」：前端说「可以用」，用户高高兴兴点保存，
//    后端却回 400 拒掉 —— Day 24 修的 Bug D 就是这么来的。
const MAX_NAME_LENGTH = 30

// 材料标题的上限，同样对齐后端 `index.js` 的 `MAX_TITLE_LENGTH = 100`。
const MAX_TITLE_LENGTH = 100

// 输入停止多久之后才判定（毫秒）。
// 为什么需要这个：用户打「课」字时名字还没打完，立刻报错是把「还没输完」误判成「输错了」。
const CHECK_DELAY = 400

// 静态托管地址前缀 —— 拼给用户看「音频应该长什么样」，不用他记
const AUDIO_URL_EXAMPLE =
  'https://xingho-read-d0gamjt5d859dbd81-1497420413.tcloudbaseapp.com/audio/你的文件名.mp3'

export default function NewMaterial() {
  // 文件夹列表：null = 还在读
  const [folders, setFolders] = useState(null)
  const [foldersError, setFoldersError] = useState('')

  const loadFolders = useCallback(async () => {
    setFoldersError('')
    try {
      const data = await fetchFolders()
      setFolders(data.folders || [])
    } catch (err) {
      // api.js 抛出的 message 已经是写好的中文，直接用（不在这里猜原因）
      setFoldersError(err.message)
      setFolders([])
    }
  }, [])

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>新建材料</h2>
          <a className="btn btn-ghost" href={ROUTES.home}>
            返回首页
          </a>
        </div>

        <MaterialForm folders={folders} foldersError={foldersError} onReloadFolders={loadFolders} />
      </div>
    </div>
  )
}

// ── 表单主体 ─────────────────────────────────────────────

function MaterialForm({ folders, foldersError, onReloadFolders }) {
  const [folderId, setFolderId] = useState('')
  const [title, setTitle] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [text, setText] = useState('')

  // 从音频地址读到的总时长（毫秒）。null = 还没读到 / 读不到
  const [durationMs, setDurationMs] = useState(null)
  const [durationState, setDurationState] = useState('idle') // idle | reading | ok | failed
  const [manualSeconds, setManualSeconds] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(null)

  // 第一次拿到文件夹列表时，默认选中第一个
  // ⚠️ 放在 effect 里而不是 useState 初始值 —— 列表是异步来的，初始值一定是空
  useEffect(() => {
    if (folders && folders.length > 0 && !folderId) {
      setFolderId(folders[0].id)
    }
  }, [folders, folderId])

  // ── 读音频时长 ──────────────────────────────────────────
  //
  // 【为什么要读时长】句段的 startMs / endMs 是「在音频里的位置」，
  //   不知道音频多长就没法算。播放第 N 句 = 跳到 startMs 播放到 endMs。
  //
  // 【为什么可能读不到】音频地址不可访问、服务器不给跨域读、
  //   或者根本不是音频文件。这三种都要**如实告诉用户**，不能假装成功。
  useEffect(() => {
    const url = audioUrl.trim()

    if (!/^https?:\/\//i.test(url)) {
      setDurationState('idle')
      setDurationMs(null)
      return
    }

    let cancelled = false
    setDurationState('reading')

    const probe = new Audio()
    probe.preload = 'metadata'

    const done = (ms) => {
      if (cancelled) return
      if (ms && ms > 0) {
        setDurationMs(ms)
        setDurationState('ok')
      } else {
        setDurationMs(null)
        setDurationState('failed')
      }
    }

    probe.onloadedmetadata = () => {
      // 跨域媒体有时给 Infinity —— 那不是真时长，当成读不到
      const d = probe.duration
      done(Number.isFinite(d) ? Math.round(d * 1000) : null)
    }
    probe.onerror = () => done(null)

    // 8 秒还没消息就放弃，别把用户卡在这一步
    const timer = setTimeout(() => done(null), 8000)

    probe.src = url

    return () => {
      cancelled = true
      clearTimeout(timer)
      probe.src = ''
    }
  }, [audioUrl])

  // 手动填的秒数（自动读不到时的退路）
  const effectiveDurationMs =
    durationState === 'ok' && durationMs
      ? durationMs
      : Number(manualSeconds) > 0
        ? Math.round(Number(manualSeconds) * 1000)
        : null

  // 按行切句
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const willCreateSentences = lines.length > 0 && effectiveDurationMs !== null

  const canSave =
    !saving && title.trim() !== '' && title.trim().length <= MAX_TITLE_LENGTH && folderId !== ''

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setSaveError('')
    setSaved(null)

    try {
      // 句段时间**按「总时长 ÷ 行数」平均分配**。
      // ⚠️ 这是**近似值**，不是按真实停顿切出来的。
      //    真正「在静音处切分」要用 Web Audio API 读波形（PRD 的规划），
      //    属后续功能。这里先用均分，让逐句播放**能跑起来**。
      //    界面上会如实写清楚，不假装是精确切分。
      const sentences = willCreateSentences
        ? lines.map((line, i) => {
            const each = Math.floor(effectiveDurationMs / lines.length)
            return {
              no: i + 1,
              text: line,
              startMs: i * each,
              endMs: i === lines.length - 1 ? effectiveDurationMs : (i + 1) * each,
            }
          })
        : []

      const data = await createMaterial({
        title: title.trim(),
        folderId,
        audioUrl: audioUrl.trim() || null,
        sentences,
      })

      setSaved({ material: data.material, sentenceCount: sentences.length })

      // 保存成功后清空表单，方便连着建下一条
      setTitle('')
      setAudioUrl('')
      setText('')
      setManualSeconds('')
      setDurationMs(null)
      setDurationState('idle')

      // 文件夹里的材料数变了 → 首页要重新读才对。这里只刷新本页的文件夹列表，
      // 首页每次进入都会重新请求，所以不用管。
      onReloadFolders()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* ① 所属文件夹 —— 读真库（P1-5） */}
      <div className="field">
        <label htmlFor="folder-select">① 所属文件夹</label>
        {folders === null ? (
          <p className="hint">正在读取文件夹列表……</p>
        ) : foldersError ? (
          <p className="field-msg msg-error">
            读取文件夹失败：{foldersError}
            <button type="button" className="btn btn-small" onClick={onReloadFolders}>
              重新读取
            </button>
          </p>
        ) : folders.length === 0 ? (
          <p className="hint">还没有任何文件夹。先在下面「② 新建文件夹」里加一个。</p>
        ) : (
          <select
            id="folder-select"
            className="input"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <p className="hint">这份列表来自数据库，和首页看到的是同一份。</p>
      </div>

      {/* ② 新建文件夹 —— 真写入 + 判重读真库（P1-2 / P1-11） */}
      <NewFolderField
        existingNames={(folders || []).map((f) => f.name)}
        onCreated={(newFolder) => {
          onReloadFolders()
          setFolderId(newFolder.id)
        }}
      />

      {/* ③ 音频地址 */}
      <div className="field">
        <label htmlFor="audio-url">③ 音频地址</label>
        <input
          id="audio-url"
          className="input"
          placeholder={AUDIO_URL_EXAMPLE}
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
        />
        <p className="hint">
          音频先用命令行传到云端，再把地址粘到这里。命令：
          <code className="code-inline">tcb hosting deploy "音频.mp3" audio/文件名.mp3</code>
        </p>
        <DurationStatus
          state={durationState}
          durationMs={durationMs}
          manualSeconds={manualSeconds}
          onManualChange={setManualSeconds}
        />
      </div>

      {/* ④ 材料标题 */}
      <div className="field">
        <label htmlFor="title">④ 材料标题</label>
        <input
          id="title"
          className={
            title.trim().length > MAX_TITLE_LENGTH ? 'input input-invalid' : 'input'
          }
          placeholder="例如：VOA 慢速英语 0902"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {title.trim().length > MAX_TITLE_LENGTH && (
          <p className="field-msg msg-error">
            标题最多 {MAX_TITLE_LENGTH} 个字符，现在有 {title.trim().length} 个
          </p>
        )}
      </div>

      {/* ⑤ 英文文本 */}
      <div className="field">
        <label htmlFor="text">⑤ 英文文本（可选）</label>
        <textarea
          id="text"
          className="input textarea"
          rows={6}
          placeholder={'一行一句。例如：\nLearning a language takes time.\nBut small steps every day add up.'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <SentencePreview
          lineCount={lines.length}
          willCreate={willCreateSentences}
          hasAudio={audioUrl.trim() !== ''}
        />
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
          {saving ? '保存中……' : '保存材料'}
        </button>
      </div>

      {saveError && <p className="field-msg msg-error">保存失败：{saveError}</p>}

      {saved && (
        <p className="field-msg msg-ok">
          已保存「{saved.material.title}」（编号 {saved.material.id}，
          {saved.sentenceCount > 0 ? `${saved.sentenceCount} 个句段` : '暂无句段'}）。
          <a href={`#/practice/${saved.material.id}`}>去练习页看看</a>
        </p>
      )}
    </>
  )
}

// ── 音频时长状态 ─────────────────────────────────────────

function DurationStatus({ state, durationMs, manualSeconds, onManualChange }) {
  if (state === 'idle') return null

  if (state === 'reading') {
    return <p className="hint">正在读取音频时长……</p>
  }

  if (state === 'ok') {
    const total = Math.round(durationMs / 1000)
    const m = Math.floor(total / 60)
    const s = String(total % 60).padStart(2, '0')
    return (
      <p className="field-msg msg-ok">
        已读到音频时长 {m}:{s}（{total} 秒）。句段时间会按「总时长 ÷ 文本行数」平均分配。
      </p>
    )
  }

  // failed
  return (
    <>
      <p className="field-msg msg-error">
        读不到这个地址的音频时长。可能原因：地址打不开、不是音频文件，或服务器不允许跨站读取。
      </p>
      <p className="hint">
        可以自己填总时长（秒）继续 —— 填了才能生成句段、才能逐句播放：
        <input
          className="input input-inline"
          type="number"
          min="1"
          placeholder="例如 204"
          value={manualSeconds}
          onChange={(e) => onManualChange(e.target.value)}
        />
      </p>
    </>
  )
}

// ── 句段预览 ─────────────────────────────────────────────

function SentencePreview({ lineCount, willCreate, hasAudio }) {
  if (lineCount === 0) {
    return <p className="hint">填了文本，练习页会在每一句旁边显示对应文字。不填也能保存。</p>
  }
  if (willCreate) {
    return (
      <p className="field-msg msg-ok">
        会按 {lineCount} 行切成 {lineCount} 个句段。
        ⚠️ 每句的时间是<strong>按总时长平均分</strong>的近似值，不是按真实停顿切出来的 ——
        真正的「在静音处切分」要用 Web Audio API 读波形，属后续功能。
    </p>
    )
  }
  return (
    <p className="field-msg msg-warn">
      填了 {lineCount} 行文本，但{hasAudio ? '还没读到音频时长' : '还没填音频地址'}
      —— 这样保存的话<strong>不会生成句段</strong>，练习页只能看到标题和一句「还没有句段」的说明。
    </p>
  )
}

// ── ② 新建文件夹：带即时校验 + 真写入 ─────────────────────
//
// 反馈设计（对应 Day 11 板块① 的三类反馈）：
//   输入中       → 不判定，只把上一次的结论清掉（不打断打字）
//   输入停止后   → 边框变色 + 一行文字说明（结果反馈）
//   点「新建」前 → 名字不可用时按钮禁用（结果反馈最高级：让误操作不可能发生）
//
// ⚠️ Day 27 起**真的会写入数据库**了。所以文案也换了：
//    以前只能说「这个名字可以用」（因为确实没写），现在能说「已创建」。

function NewFolderField({ existingNames, onCreated }) {
  const [name, setName] = useState('')
  const [checked, setChecked] = useState(null) // null = 还没判定
  const [created, setCreated] = useState(null) // 刚创建成功的名字
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // ⚠️ 判重名单从 props 来（真库），不再从 mock —— 这就是 P1-11（Bug D2）的修法。
  //    用 useRef 存一份最新的，好让 setTimeout 回调读到当前值
  //    （effect 依赖数组里放 existingNames 会导致每读一次列表就重置定时器）。
  const namesRef = useRef(existingNames)
  useEffect(() => {
    namesRef.current = existingNames
  }, [existingNames])

  // 输入停止 400ms 后再判定；下次输入会先把定时器清掉，所以连续打字不会报错
  useEffect(() => {
    const trimmed = name.trim()

    if (trimmed === '') {
      setChecked(null)
      return
    }

    const timer = setTimeout(() => {
      // 先判长度，再判重名 —— 顺序有讲究：
      // 名字太长时「重不重名」已经不重要了，因为后端连长度这一关都过不了。
      // 先报最能说明问题的那条。
      if (trimmed.length > MAX_NAME_LENGTH) {
        setChecked('too-long')
        return
      }
      setChecked(namesRef.current.includes(trimmed) ? 'duplicate' : 'ok')
    }, CHECK_DELAY)

    return () => clearTimeout(timer)
  }, [name])

  // 重新输入时，把上一次的确认提示清掉
  function handleChange(e) {
    setName(e.target.value)
    setCreated(null)
    setCreateError('')
  }

  const canConfirm = checked === 'ok' && !creating

  async function handleConfirm() {
    if (!canConfirm) return
    setCreating(true)
    setCreateError('')

    try {
      const data = await createFolder({
        // id 由前端生成：契约里 POST /api/folders 的 id 是客户端给的。
        // 用时间戳 + 随机后缀，避免同一毫秒连点两次撞车。
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: name.trim(),
      })
      setCreated(data.folder.name)
      setName('')
      setChecked(null)
      onCreated(data.folder)
    } catch (err) {
      // ⚠️ **不吞错误**。后端可能回 409（同名）—— api.js 已经把它变成中文，
      //    直接显示。这就是「不许假成功」：失败必须说出来。
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="field">
      <label htmlFor="new-folder">② 新建文件夹</label>
      <div className="row">
        <input
          id="new-folder"
          className={
            checked === 'duplicate' || checked === 'too-long'
              ? 'input input-invalid'
              : checked === 'ok'
                ? 'input input-valid'
                : 'input'
          }
          placeholder="输入文件夹名称"
          value={name}
          onChange={handleChange}
        />
        <button type="button" className="btn btn-ghost" disabled={!canConfirm} onClick={handleConfirm}>
          {creating ? '创建中……' : '新建'}
        </button>
      </div>

      <FieldMessage checked={checked} created={created} createError={createError} name={name} />
    </div>
  )
}

// 结果反馈：一行文字说清「为什么」和「下一步」。
// 文案的区别很重要 —— 「名字可以用」是校验结论，「已创建」是功能结论，两者不能混。
function FieldMessage({ checked, created, createError, name }) {
  if (createError) {
    return <p className="field-msg msg-error">没能创建：{createError}</p>
  }
  if (created) {
    return <p className="field-msg msg-ok">已创建「{created}」，并已自动选中。</p>
  }
  if (checked === 'too-long') {
    // 把「上限」和「现在多少个」都写出来 —— 只说「太长了」用户不知道要删多少
    return (
      <p className="field-msg msg-error">
        名字最多 {MAX_NAME_LENGTH} 个字符，现在有 {name.trim().length} 个
      </p>
    )
  }
  if (checked === 'duplicate') {
    return <p className="field-msg msg-error">已有同名文件夹，换一个名字</p>
  }
  if (checked === 'ok') {
    return <p className="field-msg msg-ok">这个名字可以用，点「新建」就会真的建到数据库里</p>
  }
  if (name.trim() !== '') {
    return <p className="field-msg">正在检查……</p>
  }
  return null
}
