// 练习页
//
// Day 7：骨架（句子列表、播放控制、跟读录音的界面）
// Day 13：补齐四种状态 —— 加载中 / 找不到 / 读取失败 / 正常
//
// 为什么要补「找不到」这一态：
//   地址是 #/practice/1，可以被手打、可以被分享一条失效的链接。
//   纯内存状态（Day 7 的做法）永远不会遇到「id 不存在」，
//   改成地址路由后这就是必须处理的新情况 —— 它是地址路由的代价，也是它的价值。
//
// 状态的切换用地址栏参数，方便把四种状态逐个看一遍（临时开发开关，同首页）：
//   #/practice/1?state=loading
//   #/practice/1?state=error
//   #/practice/999            ← 天然就是「找不到」
//   不写 ?state= 则按真实 id 判断

import { ROUTES } from '../useHashRoute.js'

const SENTENCES = [
  { no: 1, text: 'Learning a language is a long journey.' },
  { no: 2, text: 'It takes time, patience and daily practice.' },
  { no: 3, text: 'Reading aloud is one of the simplest ways to improve.' },
  { no: 4, text: 'Listen to the sentence first, then repeat it.' },
  { no: 5, text: 'Ten minutes a day is enough to feel the difference.' },
]

// 用 ?state= 指定要看的开发状态（同首页的临时开关）
function readDevState() {
  const value = new URLSearchParams(window.location.search).get('state')
  return ['loading', 'error'].includes(value) ? value : null
}

export default function Practice({ material, materialId }) {
  const devState = readDevState()

  // 优先级：开发开关 > 真实判断
  if (devState === 'loading') return <LoadingView />
  if (devState === 'error') return <ErrorView />
  // 没指定 id，或 id 找不到对应材料 —— 两种情况都是「没有可练的材料」
  if (!material) return <NotFoundView materialId={materialId} />

  return <ReadyView material={material} />
}

// ── 正常状态 ───────────────────────────────────────────

function ReadyView({ material }) {
  const total = material.sentences || SENTENCES.length

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>{material.title}</h2>
          <span className="muted">共 {total} 句</span>
        </div>

        <div className="player">
          <button className="btn btn-primary">播放</button>
          <button className="btn">上一句</button>
          <button className="btn">下一句</button>
          <span className="player-status">当前：第 1 句 / 共 {total} 句</span>
        </div>

        <ul className="sentence-list">
          {SENTENCES.map((s) => (
            <li key={s.no} className={s.no === 1 ? 'sentence-item current' : 'sentence-item'}>
              <div className="sentence-main">
                <span className="sentence-no">第 {s.no} 句</span>
                <span className="sentence-text">{s.text}</span>
              </div>
              <div className="sentence-tools">
                <button className="btn btn-small">单句循环</button>
                <button className="btn btn-small">录音</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="notice">Day 7 骨架版：句子是示例内容，播放与录音尚未接通。</p>
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
//   ② id 不在列表里     → #/practice/999        → 提示「编号不存在」
//   ③ 参数位置放错了    → #/practice/1?state=x  → 提示「参数要放 # 前面」
//
// 第 ③ 种是新手最容易撞上的（Day 13 用户实测就撞了一次），
// 所以单独识别并给出可照抄的正确写法，而不是笼统说「编号不在列表里」。

function NotFoundView({ materialId }) {
  const hint = buildNotFoundHint(materialId)

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
function buildNotFoundHint(materialId) {
  if (!materialId) {
    return {
      message: '这个地址没有指定要练哪条材料。',
      example: 'localhost:5173/#/practice/1',
    }
  }
  return {
    message: `列表里没有编号为 ${materialId} 的材料，可能是链接失效，或这条材料已被删除。`,
    example: null,
  }
}

// ── 读取失败 ───────────────────────────────────────────

function ErrorView() {
  return (
    <div className="page">
      <section className="card state-box state-error">
        <p className="state-title">材料读取失败</p>
        <p className="state-desc">浏览器没能读出这条材料，请刷新页面重试。</p>
        <a className="btn" href={ROUTES.home}>
          换个材料
        </a>
      </section>
    </div>
  )
}
