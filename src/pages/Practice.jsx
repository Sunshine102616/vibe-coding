// 练习页
//
// Day 7  ：骨架（句子列表、播放控制、跟读录音的界面）
// Day 13 ：补齐四种状态 —— 加载中 / 找不到 / 读取失败 / 正常
// Day 27 ：**接真数据 + 播放控制真的能用**（P1-7 / P1-8 / P1-3）
// Day 27 追加：**没有句段的材料也能「整段播放」**（48 条星一班正是这种 —— 只有音频、没有文本）
//
// 【Day 27 追加改了什么，为什么】
//   改之前：三个按钮都是 `disabled={!hasAudio || !hasSentences}`，
//   于是「只有音频、没有句段」的材料**一个按钮都点不动** ——
//   音频明明加载好了（duration 40s / readyState 4），用户却完全听不到。
//   ⚠️ 而页面上只有一句「所以没法逐句播放」，**没说「其实也放不出来」** ——
//      用户点播放没反应，会自己编个理由然后放弃（Day 14「沉默的失败」）。
//   改之后：**有没有音频**决定能不能播；**有没有句段**只决定能不能逐句。
//      · 有句段 → 原来的逐句 / 单句循环（不变）
//      · 没句段 → 整段播放，播放/暂停随时可用，状态栏显示 `整段播放 0:12 / 0:40`
//   为什么不显示浏览器自带的 `<audio controls>`：那会多出一套「和上面按钮不一致」的控件，
//   而本项目刻意不显示它（见下面渲染部分的说明）。所以用同一个按钮 + 一行进度。
//
// 【今天改了什么，为什么】
//   以前：句子列表是写死的 `SENTENCES` 五句英文，播放按钮点了没反应。
//   现在：句子来自 `GET /api/materials/:id` 的 `sentences`，播放真的能播。
//
//   ⚠️ **句子列表必须来自真数据**，这是 Day 24「假成功」那类问题的同一族：
//      界面显示「共 6 句」却列出 5 句写死的假句子，数字和内容对不上，
//      而且**控制台一条报错都没有** —— 只能靠「逐条对照」发现。
//
// 【「句段」是什么，为什么不需要一堆音频文件】
//   一条材料只有 **1 个音频文件**（`materials.audio_url`）。
//   句段是**在这一个文件里的时间段**（`start_ms` / `end_ms`）。
//   播放第 3 句 = 把播放位置跳到 `startMs/1000` 秒，播到 `endMs/1000` 停。
//   → 所以「切句段」不需要任何音频处理，只是改 `audio.currentTime`。
//
// 【播放方式有两种，靠「点击同一句两次」切换（PRD F2）】
//   点某一句         → 单句循环（只反复播这一句，视觉标识停在这句不动）
//   再点同一句       → 取消循环，从这句起**连续播放**后面的句段
//   单句循环按钮     → 同上，给不想点句子的人一个明确入口

import { useCallback, useEffect, useRef, useState } from 'react'
import { ROUTES } from '../useHashRoute.js'

// ── 页面分发：五种状态 ───────────────────────────────────
//
// ⚠️ `'not-found'` 和 `'error'` 必须分开显示（App.jsx 的 usePracticeMaterial 说明过原因）：
//   前者是「这条材料不存在」（链接失效 → 换个材料就好），
//   后者是「现在读不到」（网络/服务问题 → 重试可能就好了）。
//   合成一种，用户会去做错误的下一步。

export default function Practice({ status, material, errorMessage, materialId, onRetry }) {
  if (status === 'loading') return <LoadingView />
  if (status === 'error') return <ErrorView message={errorMessage} onRetry={onRetry} />
  if (status === 'idle' || status === 'not-found') {
    return <NotFoundView materialId={materialId} isIdle={status === 'idle'} />
  }
  return <ReadyView material={material} />
}

// ── 正常状态：播放控制 + 句子列表 ────────────────────────

/**
 * 毫秒 → `"1:05"`。只给「整段播放」的进度显示用。
 *
 * ⚠️ 为什么要显示进度：没有句段时，点「播放」界面**原本什么都不变** ——
 *    用户不知道到底在播没有，会以为自己点坏了（Day 14 的「沉默的失败」）。
 *    有了「0:12 / 0:40」，一眼就知道在走。
 */
function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function ReadyView({ material }) {
  const sentences = material.sentences || []
  const hasAudio = Boolean(material.audioUrl)
  const hasSentences = sentences.length > 0

  const audioRef = useRef(null)
  const rafRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [currentNo, setCurrentNo] = useState(hasSentences ? sentences[0].no : null)
  const [loopOne, setLoopOne] = useState(false)
  const [playError, setPlayError] = useState('')

  // 【Day 27 追加】没有句段时只能「整段播放」，这两个 state 只用来显示进度。
  //   有句段时用不上 —— 那时状态栏显示的是「第 N 句」。
  const [progressMs, setProgressMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)

  // 跟读录音（PRD F3）：句子序号 → 录音地址
  const [recordings, setRecordings] = useState({})
  const [recordingNo, setRecordingNo] = useState(null)
  const [recError, setRecError] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])

  // ── 【为什么要把这几个值复制进 ref】
  //   requestAnimationFrame 的回调是「注册时那一次渲染的闭包」，
  //   它会一直跑，却读不到之后 setState 的新值 —— 这就是经典的「闭包读到旧值」。
  //   把最新值放进 ref，回调就能随时读到。
  const sentencesRef = useRef(sentences)
  const currentNoRef = useRef(currentNo)
  const loopOneRef = useRef(loopOne)
  useEffect(() => { sentencesRef.current = sentences }, [sentences])
  useEffect(() => { currentNoRef.current = currentNo }, [currentNo])
  useEffect(() => { loopOneRef.current = loopOne }, [loopOne])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) audio.pause()
    setPlaying(false)
  }, [])

  const jumpTo = useCallback((item, andPlay) => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentNo(item.no)
    audio.currentTime = item.startMs / 1000
    if (andPlay) {
      audio
        .play()
        .then(() => setPlayError(''))
        .catch(() => setPlayError('浏览器拦下了这次播放，请再点一次播放按钮。'))
      setPlaying(true)
    }
  }, [])

  // ── 播放引擎 ────────────────────────────────────────────
  //
  // 【为什么用 requestAnimationFrame，不用 <audio> 的 timeupdate 事件】
  //   timeupdate 每秒只触发约 4 次 → 判断「这一句播完了没有」会晚最多 0.25 秒，
  //   加上回到起点重播的开销，单句循环的两次播放间隔就可能超过 PRD F2 要求的 0.5 秒。
  //   rAF 跟屏幕刷新同步（约 60 次/秒），边界判断精度足够。
  useEffect(() => {
    const audio = audioRef.current
    // ⚠️ 没有句段时不跑这个循环 —— 它是为「句段边界」服务的。
    //    那种情况由 <audio> 的 onTimeUpdate 更新进度（见下面的渲染部分）。
    //    不加这个判断的话：list 是空的 → find 返回 undefined → 立刻 setPlaying(false)，
    //    按钮会在点下去的一瞬间弹回「播放」，看起来像点了没反应。
    if (!audio || !playing || !hasSentences) return

    let stopped = false

    const tick = () => {
      if (stopped) return

      const list = sentencesRef.current
      const item = list.find((s) => s.no === currentNoRef.current)
      if (!item) {
        setPlaying(false)
        return
      }

      const nowMs = audio.currentTime * 1000 // 毫秒，和 startMs / endMs 同一单位

      if (nowMs >= item.endMs) {
        if (loopOneRef.current) {
          // 单句循环：回到这一句的起点接着播（视觉标识不动）
          audio.currentTime = item.startMs / 1000
          audio.play().catch(() => {})
        } else {
          // 连续播放：切下一句
          const idx = list.findIndex((s) => s.no === item.no)
          const next = list[idx + 1]
          if (!next) {
            // 已是最后一句 → 停下，**不回到开头**（PRD F2 明确要求）
            audio.pause()
            setPlaying(false)
            return
          }
          setCurrentNo(next.no)
          audio.currentTime = next.startMs / 1000
          audio.play().catch(() => {})
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [playing, hasSentences])

  // 离开页面时把定时器和麦克风都收干净（不然会一直占着麦克风指示灯）
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (recorderRef.current) {
        try { recorderRef.current.stop() } catch { /* 已经停了 */ }
      }
    }
  }, [])

  // ── 播放控制 ────────────────────────────────────────────

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return

    // ── 情况一：这条材料**没有句段** → 整段播放（Day 27 追加）──────
    //
    // 【为什么要有这一支】
    //   没有句段时，没有任何「边界」要判断，所以就是最普通的 播放/暂停。
    //   ⚠️ 以前这里写的是 `if (!hasAudio || !hasSentences) return` —— 就算
    //      按钮被点到，函数也会立刻返回，**什么都不会发生**。
    //      而按钮同时是 disabled，用户看到的是「灰的、点了没用」，
    //      却没有任何一句话告诉他为什么（Day 14「沉默的失败」）。
    //   → 现在：只要有音频就能播；有没有句段只决定「能不能逐句」。
    if (!hasSentences) {
      if (playing) {
        audio.pause()
        setPlaying(false)
      } else {
        audio
          .play()
          .then(() => { setPlayError(''); setPlaying(true) })
          .catch(() => setPlayError('浏览器拦下了这次播放，请再点一次播放按钮。'))
      }
      return
    }

    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }

    // 恢复播放时**保持暂停前的播放方式**（PRD F2）：
    // loopOne 和 currentNo 都是 state，本来就没被清掉，所以天然满足。
    const item = sentences.find((s) => s.no === currentNo) || sentences[0]
    const nowMs = audio.currentTime * 1000
    // 播放位置已经跑出这一句了（比如暂停后手动拖过），先拉回起点
    if (nowMs < item.startMs || nowMs >= item.endMs) {
      audio.currentTime = item.startMs / 1000
    }
    audio
      .play()
      .then(() => { setPlayError(''); setPlaying(true) })
      .catch(() => setPlayError('浏览器拦下了这次播放，请再点一次播放按钮。'))
  }

  // 点某一句：第一次 = 单句循环；再点同一句 = 取消循环、连续播放
  function handleSentenceClick(item) {
    if (!hasAudio) return
    if (currentNo === item.no && loopOne) {
      setLoopOne(false)
      jumpTo(item, true)
    } else {
      setLoopOne(true)
      jumpTo(item, true)
    }
  }

  // 上一句 / 下一句：切到相邻句段并**立即从该句开始播放**（PRD F2）
  // ⚠️ 没有句段时没有「相邻句段」可言 —— 这两个按钮也是 disabled 的，
  //    这里再挡一次只是防御（万一将来有人把 disabled 去掉）。
  function step(delta) {
    if (!hasAudio || !hasSentences) return
    const idx = sentences.findIndex((s) => s.no === currentNo)
    const target = sentences[idx + delta]
    if (!target) return
    jumpTo(target, true)
  }

  // ── 跟读录音（PRD F3）────────────────────────────────────

  async function startRecording(no) {
    // 录音前先停原声 —— 不然麦克风会把扬声器的声音一起录进去
    stop()
    setRecError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        // 录完必须把音轨关掉，否则浏览器标签页上的「麦克风使用中」指示灯一直亮
        stream.getTracks().forEach((t) => t.stop())

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })

        setRecordings((prev) => {
          // ⚠️ 释放上一条的地址，否则每录一次就泄漏一块内存
          if (prev[no] && prev[no].url) URL.revokeObjectURL(prev[no].url)
          // 同一句再录一次 → **只保留最近一次**（PRD F3 明确要求）
          return { ...prev, [no]: { url: URL.createObjectURL(blob) } }
        })
        setRecordingNo(null)
      }

      recorder.start()
      recorderRef.current = recorder
      setRecordingNo(no)
    } catch {
      // 用户拒绝授权、没有麦克风、非 HTTPS 页面……都会走到这里。
      // ⚠️ 不写死原因，只告诉他「去哪儿看」—— 猜错原因会把人带偏（Day 14 的教训）
      setRecError(
        '没能打开麦克风。请检查浏览器地址栏左侧的权限图标，确认本站可以使用麦克风。'
      )
    }
  }

  function stopRecording() {
    if (recorderRef.current) {
      try { recorderRef.current.stop() } catch { /* 已经停了 */ }
      recorderRef.current = null
    }
  }

  function deleteRecording(no) {
    setRecordings((prev) => {
      if (prev[no] && prev[no].url) URL.revokeObjectURL(prev[no].url)
      const next = { ...prev }
      delete next[no]
      return next
    })
  }

  // ── 渲染 ────────────────────────────────────────────────

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>{material.title}</h2>
          <span className="muted">
            {hasSentences ? `共 ${sentences.length} 句` : '暂无句段'}
          </span>
        </div>

        {/* 音频元素：不显示浏览器自带的控件条，播放由下面的按钮控制。
            这样「上一句 / 下一句 / 单句循环」才有一致的操作方式。
            ⚠️ 没有句段时也走这一套（整段播放），所以进度靠 onTimeUpdate 自己显示。 */}
        {hasAudio && (
          <audio
            ref={audioRef}
            src={material.audioUrl}
            preload="metadata"
            onTimeUpdate={(e) => setProgressMs(e.currentTarget.currentTime * 1000)}
            onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
            // 整段播完要把按钮变回「播放」，否则界面一直停在「暂停」
            onEnded={() => setPlaying(false)}
          />
        )}

        <div className="player">
          <button
            type="button"
            className="btn btn-primary"
            onClick={togglePlay}
            // ⚠️ 只看**有没有音频** —— 没有句段照样能整段播放。
            //    （旧版这里是 `!hasAudio || !hasSentences`，把 48 条只有音频的材料全挡死了。）
            disabled={!hasAudio}
          >
            {playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => step(-1)}
            // 逐句操作才需要句段 —— 没有句段时确实无事可做
            disabled={!hasAudio || !hasSentences}
          >
            上一句
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => step(1)}
            disabled={!hasAudio || !hasSentences}
          >
            下一句
          </button>
          <span className="player-status">
            {hasSentences && currentNo !== null
              ? `当前：第 ${currentNo} 句 / 共 ${sentences.length} 句${loopOne ? '（单句循环中）' : ''}`
              : hasAudio
                ? `整段播放　${formatTime(progressMs)} / ${formatTime(durationMs)}`
                : '暂无音频'}
          </span>
        </div>

        {/* 【说明放在卡住的现场】Day 14 的教训：用户点按钮没反应时，
            视线停在按钮上，不会往下翻页面去找说明。
            ⚠️ 所以「为什么点了没反应」必须写在按钮正下方，并且**说清不是用户的错**。 */}
        {!hasAudio && (
          <p className="player-hint">
            {hasSentences
              ? '这条材料还没有音频，所以播放按钮暂时不能用。句子文本可以正常阅读。'
              : '这条材料还没有音频，也还没有句段，所以现在只能看到标题。'}
          </p>
        )}
        {hasAudio && !hasSentences && (
          <p className="player-hint">
            这条材料<strong>只有音频、还没有句段</strong>（也就是「哪一句从第几秒到第几秒」）。
            所以现在<strong>整段播放</strong>：「播放 / 暂停」随时可用，
            「上一句 / 下一句」要等句段补上之后才能用。
          </p>
        )}
        {playError && <p className="player-hint">{playError}</p>}

        {hasSentences && (
          <ul className="sentence-list">
            {sentences.map((s) => {
              const isCurrent = s.no === currentNo
              const isRecording = recordingNo === s.no
              const rec = recordings[s.no]

              return (
                <li key={s.no} className={isCurrent ? 'sentence-item current' : 'sentence-item'}>
                  <div className="sentence-main">
                    <span className="sentence-no">第 {s.no} 句</span>
                    {/* text 可以是 null（PRD：不填文本也能保存）——
                        这时不能显示成空白，要说清「这句没填文本」 */}
                    <span className="sentence-text">
                      {s.text ? s.text : <span className="muted">（这句没有填文本）</span>}
                    </span>
                  </div>

                  <div className="sentence-tools">
                    {hasAudio && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => handleSentenceClick(s)}
                      >
                        {isCurrent && loopOne ? '取消循环' : '单句循环'}
                      </button>
                    )}

                    {isRecording ? (
                      <button type="button" className="btn btn-small btn-recording" onClick={stopRecording}>
                        停止
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => startRecording(s.no)}
                        disabled={recordingNo !== null}
                      >
                        录音
                      </button>
                    )}
                  </div>

                  {/* 录音条目：能回听、能删（PRD F3）。
                      onPlay 里停原声 —— 「播放我的录音时，原声自动停止」。 */}
                  {rec && (
                    <div className="rec-entry">
                      <span className="rec-label">我的录音</span>
                      <audio
                        className="rec-audio"
                        controls
                        src={rec.url}
                        onPlay={stop}
                      />
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => deleteRecording(s.no)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {recError && <p className="player-hint">{recError}</p>}

        {recordingNo !== null && (
          <p className="state-desc">正在录音……再点一次「停止」结束。</p>
        )}
      </div>

      {/* 说清「哪些是真的、哪些还不是」—— 含糊的说明等于没有说明（Day 14） */}
      <p className="notice">
        {!hasAudio
          ? '句子是从数据库读出来的真实数据；音频还没上传，所以播放按钮暂时不能用。'
          : hasSentences
            ? '音频和句子都是从数据库读出来的真实数据。点击某一句可以单句循环，再点一次改成连续播放。'
            : '音频是从数据库读出来的真实数据。这条材料还没有句段，所以整段播放；等句段补上之后就能逐句循环了。'}
      </p>
    </div>
  )
}

// ── 加载中 ─────────────────────────────────────────────

function LoadingView() {
  return (
    <div className="page">
      <section className="card">
        <div className="card-head">
          <h2>练习</h2>
        </div>
        <div className="skeleton-list">
          <div className="skeleton-bar w60" />
          <div className="skeleton-bar w40" />
          <div className="skeleton-bar w60" />
        </div>
        <p className="state-desc">正在读取材料……</p>
      </section>
    </div>
  )
}

// ── 找不到（地址路由带来的新状态） ──────────────────────
//
// 三种「找不到」要分开说，否则用户不知道该怎么改：
//   ① 地址没写 id       → #/practice            → 提示「没指定哪条」
//   ② id 在库里不存在   → #/practice/999        → 提示「编号不存在」
//   ③ 参数位置放错了    → #/practice/1?state=x  → 提示「参数要放 # 前面」
//
// 第 ③ 种是新手最容易撞上的（Day 13 用户实测就撞了一次），
// 所以单独识别并给出可照抄的正确写法，而不是笼统说「编号不在列表里」。

function NotFoundView({ materialId, isIdle }) {
  const hint = buildNotFoundHint({ materialId, isIdle })

  return (
    <div className="page">
      <section className="card state-box">
        <p className="state-title">找不到这条材料</p>
        <p className="state-desc">{hint.message}</p>
        {hint.example && (
          <p className="state-desc">
            正确写法：<code className="code-inline">{hint.example}</code>
          </p>
        )}
        <a className="btn btn-primary" href={ROUTES.home}>
          回到首页挑一条
        </a>
      </section>
    </div>
  )
}

// 判断是哪种「找不到」，返回对应的说明。
// ⚠️ 注意：能走到这里说明 parseHash 已经把 id 修好了（见 useHashRoute.js），
//    所以「参数位置」这种情况的实际表现是「id 正常但页面还是找不到」——
//    这里保留识别逻辑只为提示更准确，正常情况下 ③ 已经不会触发。
function buildNotFoundHint({ materialId, isIdle }) {
  if (isIdle || !materialId) {
    return {
      message: '这个地址没有指定要练哪条材料。',
      // Day 15 修复：原来写的是 'localhost:5173/#/practice/1'，在公网上会误导用户。
      // 用相对路径而不是拼当前域名 —— 提示要教的是「路径怎么写」，
      // 不是「访问哪个域名」。域名会变（本地 / 公网 / 以后可能换），
      // 写相对路径本地和线上都对，这段文案以后不用再改。
      example: '#/practice/1',
    }
  }
  return {
    message: `数据库里没有编号为 ${materialId} 的材料，可能是链接失效，或这条材料已被删除。`,
    example: null,
  }
}

// ── 读取失败 ───────────────────────────────────────────
//
// ⚠️ 和「找不到」分开：这里给的是**重试**（网络抖了一下通常点一下就好），
//    而「找不到」给的是**换个材料**（重试多少次都还是不存在）。

function ErrorView({ message, onRetry }) {
  return (
    <div className="page">
      <section className="card state-box state-error">
        <p className="state-title">材料读取失败</p>
        <p className="state-desc">{message}</p>
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            重新读取
          </button>
          <a className="btn" href={ROUTES.home}>
            回到首页
          </a>
        </div>
      </section>
    </div>
  )
}
