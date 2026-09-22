// 练习页（Day 7 骨架版）
// 界面依据 PRD 第三节：句子列表（编号 + 可选文本）、播放控制、跟读录音。
// 句子是示例内容，播放与录音都还没接通。

const SENTENCES = [
  { no: 1, text: 'Learning a language is a long journey.' },
  { no: 2, text: 'It takes time, patience and daily practice.' },
  { no: 3, text: 'Reading aloud is one of the simplest ways to improve.' },
  { no: 4, text: 'Listen to the sentence first, then repeat it.' },
  { no: 5, text: 'Ten minutes a day is enough to feel the difference.' },
]

export default function Practice({ material, onBack }) {
  const title = material ? material.title : '示例材料'
  const total = material && material.sentences ? material.sentences : SENTENCES.length

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onBack}>
            返回首页
          </button>
        </div>

        <div className="player">
          <button className="btn btn-primary">播放</button>
          <button className="btn">上一句</button>
          <button className="btn">下一句</button>
          <span className="muted">
            当前：第 1 句 / 共 {total} 句
          </span>
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
