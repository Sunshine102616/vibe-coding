// 新建页（Day 7 骨架版 → Day 11 加即时校验）
// 界面依据 PRD 第三节：上传音频、粘贴文本（可选）、新建文件夹。
// Day 11：给「② 新建文件夹」加上输入即时校验与结果提示；
//          选文件、粘贴、保存材料仍然没接通（属以后的天数）。

import { useEffect, useState } from 'react'
import homeData from '../mock/homeData.js'
import { ROUTES } from '../useHashRoute.js'

// 已有文件夹名字列表，用来判重。
// 用 mock 数据而不是在本文件里另写一份，避免两处数据不一致 —— 第 3 周接真实数据时只改一处。
const EXISTING_NAMES = homeData.folders
  .filter((f) => f.id !== 'all') // 「全部材料」不是真文件夹，只是看全部的入口
  .map((f) => f.name)

// 输入停止多久之后才判定（毫秒）。
// 为什么需要这个：用户打「课」字时名字还没打完，立刻报错是把「还没输完」误判成「输错了」。
const CHECK_DELAY = 400

// Day 13：不再接收 onBack —— 返回改由地址栏（面包屑 + 返回上一页）负责。
export default function NewMaterial() {
  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>新建材料</h2>
          <a className="btn btn-ghost" href={ROUTES.home}>
            返回首页
          </a>
        </div>

        <div className="field">
          <label>① 所属文件夹</label>
          <select className="input" defaultValue="未分类">
            <option>未分类</option>
            <option>课本音频</option>
            <option>听力训练</option>
          </select>
          <p className="hint">还没有合适的文件夹？在下面「新建文件夹」里加一个。</p>
        </div>

        <NewFolderField />

        <div className="field">
          <label>③ 选择音频文件（必填）</label>
          <input
            className="input"
            type="file"
            accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg"
          />
          <p className="hint">支持的格式：mp3 / m4a / wav / ogg（视频本期不支持）。</p>
        </div>

        <div className="field">
          <label>④ 材料标题</label>
          <input className="input" placeholder="选完音频后自动填入文件名，可以改" />
        </div>

        <div className="field">
          <label>⑤ 英文文本（可选）</label>
          <textarea
            className="input textarea"
            rows={6}
            placeholder="粘贴与这段音频对应的英文文本；不填也能保存"
          />
          <p className="hint">填了文本，练习页会在每一句旁边显示对应文字。</p>
        </div>

        <div className="actions">
          <button className="btn btn-primary">保存材料</button>
        </div>
      </div>

      <p className="notice">Day 7 骨架版：表单已就位，选文件 / 保存等逻辑尚未接通。</p>
    </div>
  )
}

// ── ② 新建文件夹：带即时校验 ─────────────────────────────
//
// 反馈设计（对应 Day 11 板块① 的三类反馈）：
//   输入中       → 不判定，只把上一次的结论清掉（不打断打字）
//   输入停止后   → 边框变色 + 一行文字说明（结果反馈）
//   点「新建」前 → 名字不可用时按钮禁用（结果反馈最高级：让误操作不可能发生）
//
// ⚠️ 诚实原则：本页的数据层还没接，点击「新建」**不会真的创建文件夹**。
//    所以提示文案必须说真话 —— 只报「名字通过校验」，不谎称「已创建」。
//    等第 3 周接上数据层后，再把这里改成真正的创建成功提示。

function NewFolderField() {
  const [name, setName] = useState('')
  const [checked, setChecked] = useState(null) // null = 还没判定
  const [confirmed, setConfirmed] = useState(null) // 刚通过校验的名字

  // 输入停止 400ms 后再判定；下次输入会先把定时器清掉，所以连续打字不会报错
  useEffect(() => {
    const trimmed = name.trim()

    if (trimmed === '') {
      setChecked(null)
      return
    }

    const timer = setTimeout(() => {
      setChecked(EXISTING_NAMES.includes(trimmed) ? 'duplicate' : 'ok')
    }, CHECK_DELAY)

    return () => clearTimeout(timer)
  }, [name])

  // 重新输入时，把上一次的确认提示清掉
  function handleChange(e) {
    setName(e.target.value)
    setConfirmed(null)
  }

  const canConfirm = checked === 'ok'

  function handleConfirm() {
    if (!canConfirm) return
    // 只做界面反馈，不真的写入数据 —— 数据层还是 mock，属「不依赖后端」的范围
    setConfirmed(name.trim())
    setName('')
    setChecked(null)
  }

  return (
    <div className="field">
      <label>② 新建文件夹</label>
      <div className="row">
        <input
          className={
            checked === 'duplicate'
              ? 'input input-invalid'
              : checked === 'ok'
                ? 'input input-valid'
                : 'input'
          }
          placeholder="输入文件夹名称"
          value={name}
          onChange={handleChange}
        />
        <button className="btn btn-ghost" disabled={!canConfirm} onClick={handleConfirm}>
          新建
        </button>
      </div>

      <FieldMessage checked={checked} confirmed={confirmed} name={name} />
    </div>
  )
}

// 结果反馈：一行文字说清「为什么」和「下一步」。
// 文案的区别很重要 —— 「名字可以用」是校验结论，「已创建」是功能结论，两者不能混。
function FieldMessage({ checked, confirmed, name }) {
  if (confirmed) {
    return (
      <p className="field-msg msg-ok">
        「{confirmed}」这个名字可以用。保存功能还没接，关闭页面后不会保留。
      </p>
    )
  }
  if (checked === 'duplicate') {
    return <p className="field-msg msg-error">已有同名文件夹，换一个名字</p>
  }
  if (checked === 'ok') {
    return <p className="field-msg msg-ok">这个名字可以用</p>
  }
  if (name.trim() !== '') {
    return <p className="field-msg">正在检查……</p>
  }
  return null
}
