import { useCallback, useEffect, useRef, useState } from 'react'
import { ROUTES } from '../useHashRoute.js'

export default function Practice({ status, material, errorMessage, materialId, onRetry }) {
  if (status === 'loading') return <LoadingView />
  if (status === 'error') return <ErrorView message={errorMessage} onRetry={onRetry} />
  if (status === 'idle' || status === 'not-found') {
    return <NotFoundView materialId={materialId} isIdle={status === 'idle'} />
  }
  return <ReadyView key={material.id} material={material} />
}

function formatTime(ms) {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

function closeStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function ReadyView({ material }) {
  const sentences = material.sentences || []
  const hasAudio = Boolean(material.audioUrl)
  const hasSentences = sentences.length > 0
  const [playing, setPlaying] = useState(false)
  const [playPending, setPlayPending] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [audioStatus, setAudioStatus] = useState(hasAudio ? 'loading' : 'empty')
  const [currentNo, setCurrentNo] = useState(sentences[0]?.no ?? null)
  const [loopOne, setLoopOne] = useState(false)
  const [playError, setPlayError] = useState('')
  const [progressMs, setProgressMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [recordings, setRecordings] = useState({})
  const [capture, setCapture] = useState({ phase: 'idle', no: null })
  const [recError, setRecError] = useState(null)
  const [recFeedback, setRecFeedback] = useState(null)

  const audioRef = useRef(null)
  const currentNoRef = useRef(currentNo)
  const loopOneRef = useRef(false)
  const playRequestRef = useRef(0)
  const mountedRef = useRef(true)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const captureBusyRef = useRef(false)
  const recordingsRef = useRef({})
  const replaysRef = useRef(new Map())
  const replayCallbacksRef = useRef(new Map())

  function replayRef(no) {
    if (!replayCallbacksRef.current.has(no)) {
      replayCallbacksRef.current.set(no, (element) => {
        if (element) replaysRef.current.set(no, element)
        else { replaysRef.current.get(no)?.pause(); replaysRef.current.delete(no) }
      })
    }
    return replayCallbacksRef.current.get(no)
  }

  function selectSentence(no) {
    currentNoRef.current = no
    setCurrentNo(no)
  }
  function selectLoop(value) {
    loopOneRef.current = value
    setLoopOne(value)
  }
  const stop = useCallback(() => {
    playRequestRef.current += 1
    audioRef.current?.pause()
    setPlaying(false)
    setPlayPending(false)
    setBuffering(false)
  }, [])
  const pauseReplays = useCallback((exceptNo) => {
    replaysRef.current.forEach((audio, no) => { if (no !== exceptNo) audio.pause() })
  }, [])

  const playOriginal = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || captureBusyRef.current) return
    const request = ++playRequestRef.current
    pauseReplays()
    setPlayPending(true)
    setCompleted(false)
    setPlayError('')
    try {
      await audio.play()
      if (!mountedRef.current || request !== playRequestRef.current) return
      setPlaying(true)
      setPlayPending(false)
    } catch (error) {
      if (!mountedRef.current || request !== playRequestRef.current) return
      setPlaying(false)
      setPlayPending(false)
      setBuffering(false)
      setPlayError(error.name === 'NotAllowedError'
        ? '浏览器暂未允许播放，请再点一次播放按钮。'
        : '没能播放这段音频，请检查网络和音频地址后再试。')
    }
  }, [pauseReplays])

  const seekTo = useCallback((item) => {
    const audio = audioRef.current
    if (!audio) return false
    try {
      if (Number.isFinite(audio.duration) && audio.duration > 0 && item.startMs / 1000 >= audio.duration) {
        throw new Error('outside-duration')
      }
      audio.currentTime = item.startMs / 1000
      setCompleted(false)
      setProgressMs(item.startMs)
      currentNoRef.current = item.no
      setCurrentNo(item.no)
      return true
    } catch {
      stop()
      setPlayError('无法定位到这一句，请检查音频是否加载完成，以及句段时间是否在音频范围内。')
      return false
    }
  }, [stop])

  const advance = useCallback(() => {
    const audio = audioRef.current
    const index = sentences.findIndex((item) => item.no === currentNoRef.current)
    const target = loopOneRef.current ? sentences[index] : sentences[index + 1]
    if (index < 0 || !target) { stop(); setCompleted(true); return false }
    if (!seekTo(target)) return false
    // During normal playback seeking preserves playback. At the file's end it must restart.
    if (audio.paused || audio.ended) playOriginal()
    return true
  }, [sentences, seekTo, stop, playOriginal])

  useEffect(() => {
    if (!playing || !hasSentences) return
    let frame
    const tick = () => {
      const audio = audioRef.current
      const item = sentences.find((sentence) => sentence.no === currentNoRef.current)
      if (!audio) { stop(); return }
      // A manual seek may reach the audio after the last sentence. Let that tail play.
      if (item && audio.currentTime * 1000 >= item.endMs && !advance()) return
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, hasSentences, sentences, advance, stop])

  useEffect(() => {
    mountedRef.current = true
    const originalAudio = audioRef.current
    return () => {
      mountedRef.current = false
      playRequestRef.current += 1
      originalAudio?.pause()
      const recorder = recorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') {
          try { recorder.stop() } catch { /* Tracks are closed below regardless. */ }
        }
      }
      closeStream(streamRef.current)
      replaysRef.current.forEach((audio) => audio.pause())
      Object.values(recordingsRef.current).forEach((recording) => URL.revokeObjectURL(recording.url))
    }
  }, [])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio || captureBusyRef.current) return
    if (playing || playPending) { stop(); return }
    if (hasSentences && currentNoRef.current !== null) {
      const item = sentences.find((sentence) => sentence.no === currentNoRef.current) || sentences[0]
      const now = audio.currentTime * 1000
      if ((now < item.startMs || now >= item.endMs) && !seekTo(item)) return
    } else if (audio.ended) {
      audio.currentTime = 0
      if (hasSentences) selectSentence(sentences[0].no)
    }
    playOriginal()
  }

  function handleSentenceClick(item) {
    if (!hasAudio || captureBusyRef.current) return
    selectLoop(!(currentNoRef.current === item.no && loopOneRef.current))
    if (seekTo(item)) playOriginal()
  }

  function step(delta) {
    if (!hasAudio || captureBusyRef.current) return
    const index = sentences.findIndex((item) => item.no === currentNoRef.current)
    const target = sentences[index + delta]
    if (target && seekTo(target)) playOriginal()
  }

  function seekPlayback(event) {
    const audio = audioRef.current
    if (!audio || !durationMs || captureBusyRef.current || audioStatus === 'error') return
    const targetMs = Math.min(durationMs, Math.max(0, Number(event.target.value)))
    try {
      const ranges = audio.seekable
      if (ranges.length && !Array.from({ length: ranges.length }, (_, index) =>
        targetMs / 1000 >= ranges.start(index) && targetMs / 1000 <= ranges.end(index) + 0.1
      ).some(Boolean)) throw new Error('not-seekable')
      audio.currentTime = targetMs / 1000
      if (hasSentences) {
        const target = sentences.find((sentence) => targetMs < sentence.endMs)
        if (target?.no !== currentNoRef.current) selectLoop(false)
        selectSentence(target?.no ?? null)
      }
      setProgressMs(targetMs)
      setCompleted(false)
      setPlayError('')
    } catch {
      setProgressMs(audio.currentTime * 1000)
      setPlayError('暂时不能跳到这个位置，请等待音频加载完成后再试。')
    }
  }

  function finishCapture() {
    const recorder = recorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
    }
    recorderRef.current = null
    closeStream(streamRef.current)
    streamRef.current = null
    captureBusyRef.current = false
    if (mountedRef.current) setCapture({ phase: 'idle', no: null })
  }

  async function startRecording(no) {
    if (captureBusyRef.current) return
    stop()
    pauseReplays()
    selectSentence(no)
    setRecError(null)
    setRecFeedback(null)
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecError({ no, message: '当前浏览器无法录音。请在支持麦克风录音的浏览器中，通过 HTTPS 或本机地址打开。' })
      return
    }
    captureBusyRef.current = true
    setCapture({ phase: 'requesting', no })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) { closeStream(stream); return }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks = []
      let failed = false
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        failed = true
        if (mountedRef.current) setRecError({ no, message: '录音中断了，这次没有保存。请检查麦克风后重新录制。' })
        if (recorder.state !== 'inactive') {
          try { recorder.stop() } catch { /* Close the stream even if stopping fails. */ }
        }
        finishCapture()
      }
      recorder.onstop = () => {
        if (mountedRef.current && !failed) {
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
            if (!blob.size) throw new Error('empty-recording')
            const url = URL.createObjectURL(blob)
            const previous = recordingsRef.current[no]
            replaysRef.current.get(no)?.pause()
            if (previous) URL.revokeObjectURL(previous.url)
            const next = { ...recordingsRef.current, [no]: { url } }
            recordingsRef.current = next
            setRecordings(next)
            setRecFeedback({ no, message: '已录好，可以回听。' })
          } catch {
            setRecError({ no, message: '这次没能生成录音，原有录音仍保留。请检查麦克风后再试。' })
          }
        }
        finishCapture()
      }
      recorderRef.current = recorder
      recorder.start()
      setCapture({ phase: 'recording', no })
    } catch {
      finishCapture()
      if (mountedRef.current) setRecError({ no, message: '没能打开麦克风。请检查浏览器地址栏左侧的权限设置，确认本站可以使用麦克风。' })
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    setCapture((current) => ({ ...current, phase: 'saving' }))
    try { recorder.stop() } catch {
      const no = capture.no
      finishCapture()
      setRecError({ no, message: '没能结束这次录音，请检查麦克风后重试。' })
    }
  }

  function deleteRecording(no) {
    const recording = recordingsRef.current[no]
    if (!recording) return
    replaysRef.current.get(no)?.pause()
    URL.revokeObjectURL(recording.url)
    const next = { ...recordingsRef.current }
    delete next[no]
    recordingsRef.current = next
    setRecordings(next)
    setRecError(null)
    setRecFeedback({ no, message: '已删除这句的录音。' })
  }

  const currentIndex = sentences.findIndex((item) => item.no === currentNo)
  const captureBusy = capture.phase !== 'idle'
  const mode = hasSentences && currentIndex >= 0 ? loopOne ? '单句循环' : '连续播放' : '整段播放'
  const canSeek = hasAudio && durationMs > 0 && !captureBusy && audioStatus !== 'error'
  const seekHint = captureBusy ? '录音结束后可拖动'
    : audioStatus === 'error' ? '音频加载失败，暂时不能拖动'
      : !durationMs ? '正在读取音频，稍后可拖动' : '拖动或点选，跳到想听的位置'
  const progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, progressMs / durationMs * 100)) : 0
  const playbackStatus = !hasAudio ? '暂无音频' : captureBusy ? '录音结束后可播放原声'
    : playPending ? '正在开始播放……' : buffering ? '音频缓冲中……'
      : playing ? '正在播放' : audioStatus === 'error' ? '音频暂时无法播放'
        : completed ? '本轮播放已结束' : progressMs > 0 ? '已暂停' : '待播放'

  return (
    <div className="page practice-page">
      <header className="practice-heading">
        <p className="practice-kicker">跟读练习 <span>·</span> {hasSentences ? sentences.length + ' 个句段' : '整段聆听'}</p>
        <h1>{material.title}</h1>
        <p>{hasSentences ? '听原声 → 录音跟读 → 回听比较，跟着这三步练习。' : '点播放开始听，拖动进度条可以从想听的位置继续。'}</p>
      </header>
      <div className="practice-layout">
        <section className="practice-sheet" aria-label="跟读练习内容">
          {hasAudio && (
            <audio ref={audioRef} className="original-audio" src={material.audioUrl} preload="metadata"
              onTimeUpdate={(event) => setProgressMs(event.currentTarget.currentTime * 1000)}
              onLoadedMetadata={(event) => {
                const ms = event.currentTarget.duration * 1000
                setDurationMs(Number.isFinite(ms) && ms > 0 ? ms : 0)
                setAudioStatus('ready')
              }}
              onCanPlay={() => setAudioStatus('ready')}
              onPlaying={() => setBuffering(false)} onWaiting={() => setBuffering(true)}
              onPause={() => { setPlaying(false); setBuffering(false) }}
              onEnded={() => { if (hasSentences) advance(); else { stop(); setCompleted(true) } }}
              onError={() => {
                stop()
                setAudioStatus('error')
                setPlayError('音频加载失败，请检查网络，或确认这份材料的音频地址仍可访问。')
              }} />
          )}
          <div className="practice-player" aria-label="原声播放控制">
            <div className="practice-player-labels">
              <p><strong>{mode}</strong>{hasSentences && currentIndex >= 0 && <span>第 {currentIndex + 1} 句 / 共 {sentences.length} 句</span>}</p>
              <span className="practice-time">{formatTime(progressMs)} / {durationMs ? formatTime(durationMs) : audioStatus === 'loading' ? '时长读取中' : '时长未知'}</span>
            </div>
            {hasAudio && (
              <div className="practice-seek-area">
                <div className="practice-seek-label"><label htmlFor="playback-position">播放进度</label><span id="seek-hint">{seekHint}</span></div>
                <input id="playback-position" className="practice-seek" type="range" min="0" max={durationMs || 1} step="100"
                  value={Math.min(Math.max(0, progressMs), durationMs)} disabled={!canSeek} onChange={seekPlayback}
                  style={{ '--seek-progress': progressPercent + '%' }} aria-describedby="seek-hint"
                  aria-valuetext={formatTime(progressMs) + '，总时长 ' + formatTime(durationMs)} />
              </div>
            )}
            <div className="practice-player-actions">
              <button type="button" className="btn btn-primary practice-play" onClick={togglePlay}
                disabled={!hasAudio || captureBusy} aria-pressed={playing}>
                <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                  {playing || playPending ? <path d="M5 3h4v14H5zm6 0h4v14h-4z" fill="currentColor" /> : <path d="M5 3l12 7-12 7z" fill="currentColor" />}
                </svg>
                {playPending ? '取消播放' : playing ? '暂停' : '播放原声'}
              </button>
              {hasSentences && <>
                <button type="button" className="btn" onClick={() => step(-1)} disabled={!hasAudio || currentIndex <= 0 || captureBusy}>上一句</button>
                <button type="button" className="btn" onClick={() => step(1)} disabled={!hasAudio || currentIndex < 0 || currentIndex >= sentences.length - 1 || captureBusy}>下一句</button>
              </>}
            </div>
            <p className="playback-status" role="status">{playbackStatus}</p>
            {!hasAudio && <p className="practice-player-hint">这份材料还没有音频，暂时不能播放。{hasSentences ? '你仍可以阅读文本、录音跟读。' : '目前只有材料标题。'}</p>}
            {playError && <p className="field-msg msg-error" role="alert">{playError}</p>}
          </div>

          {hasSentences ? (
            <div className="practice-sentences">
              <div className="practice-list-heading"><h2>逐句跟读</h2><p>点「录音跟读」开始，读完点「停止录音」，再播放自己的录音。</p><p>想反复听一句？点击句子开启循环，再点一次恢复连续播放。</p></div>
              <ol className="sentence-list">
                {sentences.map((sentence) => {
                  const no = sentence.no
                  const isCurrent = currentNo === no
                  const isRecording = capture.no === no && capture.phase === 'recording'
                  const isRequesting = capture.no === no && capture.phase === 'requesting'
                  const isSaving = capture.no === no && capture.phase === 'saving'
                  const recording = recordings[no]
                  return (
                    <li key={no} className={'sentence-item' + (isCurrent ? ' current' : '') + (isRecording ? ' is-recording' : '')}>
                      <div className="sentence-heading"><span className="sentence-no">第 {no} 句</span><span className="sentence-timing">{formatTime(sentence.startMs)} — {formatTime(sentence.endMs)}</span>{isCurrent && <span className="sentence-current">当前句</span>}</div>
                      <button type="button" className="sentence-reading" onClick={() => handleSentenceClick(sentence)}
                        disabled={!hasAudio || captureBusy} aria-pressed={isCurrent && loopOne}
                        aria-label={'第 ' + no + ' 句：' + (sentence.text || '未填文本') + (isCurrent && loopOne ? '，取消循环' : '，单句循环')}>
                        <span className="sentence-text" lang={sentence.text ? 'en' : undefined}>{sentence.text || '这句没有填写文本，听原声也可以练习。'}</span>
                      </button>
                      <div className="sentence-tools">
                        <button type="button" className="btn btn-small" onClick={() => handleSentenceClick(sentence)}
                          aria-pressed={isCurrent && loopOne} disabled={!hasAudio || captureBusy}>{isCurrent && loopOne ? '取消循环' : '单句循环'}</button>
                        <button type="button" className={'btn btn-small' + (isRecording ? ' btn-recording' : '')}
                          onClick={() => isRecording ? stopRecording() : startRecording(no)}
                          disabled={captureBusy && !isRecording}>
                          {isRequesting ? '等待麦克风……' : isSaving ? '正在生成录音……' : isRecording ? '停止录音' : recording ? '重新录音' : '录音跟读'}
                        </button>
                      </div>
                      {capture.no === no && captureBusy && <p className={'recording-status' + (isRecording ? ' msg-error' : '')} role="status">{isRequesting ? '正在请求麦克风权限，请留意浏览器提示。' : isSaving ? '正在生成可回听的录音……' : '录音中……读完后点「停止录音」。'}</p>}
                      {recording && (
                        <div className="rec-entry">
                          <span className="rec-label" id={'recording-label-' + no}>我的录音</span>
                          <audio id={'recording-' + no} className="rec-audio" controls preload="metadata" src={recording.url}
                            aria-labelledby={'recording-label-' + no} ref={replayRef(no)}
                            onPlay={(event) => {
                              if (captureBusyRef.current) { event.currentTarget.pause(); setRecError({ no, message: '请先结束录音，再回听已有录音。' }); return }
                              stop(); pauseReplays(no)
                            }}
                            onError={() => setRecError({ no, message: '这条录音暂时无法回听，请重新录制这一句。' })} />
                          <button type="button" className="btn btn-small" disabled={captureBusy} onClick={() => deleteRecording(no)}>删除录音</button>
                        </div>
                      )}
                      {recError?.no === no && <p className="field-msg msg-error" role="alert">{recError.message}</p>}
                      {recFeedback?.no === no && <p className="field-msg msg-ok" role="status">{recFeedback.message}</p>}
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : (
            <div className="whole-audio-note">
              <span>怎么开始</span><h2>{hasAudio ? '点击「播放原声」开始听' : '材料还在准备中。'}</h2>
              <p>{hasAudio ? '想重听某一段？拖动上方进度条，找到想听的位置。这份材料只有整段音频，暂不支持逐句跟读录音。' : '音频和句段都还没有添加，可以返回材料库选择另一份材料。'}</p>
              {!hasAudio && <a className="btn" href={ROUTES.home}>返回材料库</a>}
            </div>
          )}
          {hasSentences && <p className="practice-recording-note">录音仅保留在当前练习页，刷新或离开后会清除。同一句重新录音，会替换上一条。</p>}
        </section>
        <aside className="practice-aside" aria-label="练习提示">
          <div className="practice-atmosphere"><img src="/study-morning.png" alt="" width="1536" height="1024" /><div><h2>给开口一点时间。</h2><p>戴上耳机，留一小段时间，<br />把听到的英语读成自己的声音。</p></div></div>
          <div className="practice-tips"><h2>这样练就好</h2><ol><li><strong>听原声</strong><span>先听节奏，再留意发音。</span></li><li><strong>自己读</strong><span>一句一句录，不必急着读完。</span></li><li><strong>回听比较</strong><span>听听哪里可以更自然。</span></li></ol><p>{hasSentences ? '录音仅保留在当前页面，不会上传到云端。' : '有句段的材料可以逐句跟读和录音。'}</p></div>
        </aside>
      </div>
    </div>
  )
}

function LoadingView() {
  return <div className="page practice-page"><section className="card practice-loading" aria-busy="true"><h1>跟读练习</h1><div className="skeleton-list" aria-hidden="true"><div className="skeleton-bar" /><div className="skeleton-bar" /><div className="skeleton-bar" /></div><p className="state-desc" role="status">正在读取材料……</p></section></div>
}

function NotFoundView({ materialId, isIdle }) {
  return <div className="page practice-page"><section className="card state-box"><p className="state-symbol" aria-hidden="true">{isIdle ? '♪' : '?'}</p><h1 className="state-title">{isIdle ? '今天想读哪一段？' : '找不到这份材料'}</h1><p className="state-desc">{isIdle ? '先从材料库选一份喜欢的内容，再开始听和读。' : '这份材料可能已被删除，或链接已经失效。你可以回到材料库重新选择。'}</p>{!isIdle && materialId && <p className="state-desc">材料编号：{materialId}</p>}<a className="btn btn-primary" href={ROUTES.home}>去材料库选一份</a></section></div>
}

function ErrorView({ message, onRetry }) {
  return <div className="page practice-page"><section className="card state-box state-error"><p className="state-symbol" aria-hidden="true">!</p><h1 className="state-title">材料读取失败</h1><p className="state-desc" role="alert">{message || '暂时无法连接服务器，请检查网络后再试。'}</p><div className="empty-actions"><button type="button" className="btn btn-primary" onClick={onRetry}>重新读取</button><a className="btn" href={ROUTES.home}>返回材料库</a></div></section></div>
}
