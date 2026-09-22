// 新建页（Day 7 骨架版）
// 界面依据 PRD 第三节：上传音频、粘贴文本（可选）、新建文件夹。
// 表单元素都已就位，但还没接真实逻辑——选文件、粘贴、保存都还不生效。

export default function NewMaterial({ onBack }) {
  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <h2>新建材料</h2>
          <button className="btn btn-ghost" onClick={onBack}>
            返回首页
          </button>
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

        <div className="field">
          <label>② 新建文件夹</label>
          <div className="row">
            <input className="input" placeholder="输入文件夹名称" />
            <button className="btn btn-ghost">新建</button>
          </div>
        </div>

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
