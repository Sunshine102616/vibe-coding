---
name: xingho-conventions
description: XingHo Read 项目（vibe coding）的约定自检。在改动本项目任何代码、样式或产品文档前加载；在写 React 组件、改 CSS、加交互、准备 git 提交、或讨论产品范围变更时使用。用于确认改动符合本项目的技术栈约束、设计规则、可访问性与协作流程。
---

# XingHo Read 项目约定自检

## 这个 Skill 做什么

在动手改代码或文档**之前**，按下面的清单走一遍，避免改出「不符合本项目规矩」的东西。
它不是知识库 —— 规则细节在项目文件里，本 Skill 只负责**告诉你什么时候去看、看什么、按什么格式报告**。

## 铁律：不抄规则，只写指针

规则只有**一处**来源。本 Skill 内**不得复制**色值、间距数值、按钮尺寸等具体规格。

理由：抄一份就有两份，改了一处忘了另一处，Skill 会变成说谎的文件 —— 这和项目里被判为缺陷的「假成功」是同一类错误。

需要具体数值时，**去读下面指出的文件**。

## 规则来源（按需读，不要全读）

| 要确认什么 | 读哪个文件 | 什么时机读 |
|---|---|---|
| 产品范围、功能清单、验收标准 | `PRD.md` | 要加功能 / 判断某功能是否属于当前范围时 |
| 技术选型与数据流向 | `TECH_DESIGN.md` | 要引入新依赖 / 改架构时 |
| 色板、间距刻度、按钮档位、对比度、组件规格 | `DESIGN_RULES.md` | **改任何 CSS 或界面结构前，必读** |
| 协作规则、每日任务边界、提交格式 | `AGENTS.md` | 每次开工、每次提交前 |
| 遗留问题与优先级 | `待办清单.md` | 想「顺手修点什么」时，先查这里 |

## 检查清单

### A. 技术栈约束

- [ ] 没有引入 UI 组件库（Material UI / Ant Design / Tailwind 等）
- [ ] 没有引入路由库（react-router 等）；页面切换仍由 `App.jsx` 状态管理
- [ ] 样式仍是**手写 CSS**（`src/styles.css`），没有 CSS-in-JS、没有 CSS Modules
- [ ] 语言仍是 JavaScript，没有改成 TypeScript
- [ ] 新增依赖前已先问过用户（`AGENTS.md`：拿不准先问，不要猜）

### B. 设计规则

改界面前**先读 `DESIGN_RULES.md`**，再逐项确认：

- [ ] 用到的颜色都在该文件第二节的色板里，**没有临时新造的色**
- [ ] 间距只用刻度值 `4 / 8 / 12 / 16 / 24 / 32 / 48`，没有 `6 / 10 / 14 / 18 / 20 / 36`
- [ ] 按钮高度取自设计规则的档位表，没有新高度
- [ ] 同层级元素左边缘对齐同一条竖线
- [ ] 同一语义的组件（按钮、列表、卡片）跨页面**长得一样**；改一处要三处一起改

### C. 可访问性（加练项）

- [ ] 可点元素是 `<button>` 或 `<a>`，**不是**带 `onClick` 的 `<div>` / `<span>`
- [ ] 键盘 `Tab` 能走到每个可交互元素，且**焦点看得见**（`:focus-visible` 有样式）
- [ ] 纯图标按钮有 `aria-label`；切换类按钮有 `aria-pressed`
- [ ] 表单控件有对应的 `<label>`，或 `aria-label`
- [ ] 文字对比度达标：正文 ≥ 4.5:1；大字（≥18px，或 ≥14px 粗体）≥ 3:1
- [ ] 非文字元素（边框、图标、焦点环）对比度 ≥ 3:1
- [ ] 只用颜色传达状态时，**同时给了文字**（颜色是暗示，文字是直述）

### D. 交互反馈

- [ ] 任何可点的东西都有反馈 —— 不允许「点了完全没反应」
- [ ] 有延迟的操作（> 100ms）要有过程反馈（如「正在检查……」，否则用户以为卡死）
- [ ] 反馈**必须说真话**：功能还没接就不能说「已创建」。参照项目 Day 11 的修正 ——「假成功」比没反应更糟

### E. 协作流程（`AGENTS.md`）

- [ ] 改动在当天清单的范围内；**范围外的想法只记录，不动手**
- [ ] 涉及产品范围变更时，先改 `PRD.md` → 再看 `TECH_DESIGN.md` → **最后**才写代码
- [ ] 一次只做一步，做完停下等确认
- [ ] 提交前先列出改动文件清单并注明归属天数
- [ ] 提交信息格式：`Day N｜一句话`
- [ ] 密钥、`.env` 不进代码、不进提交

### F. 外部标准体检（Impeccable，2026-09-28 接入）

改完界面后，多跑一条外部检测：

```bash
npx impeccable@latest detect src/
```

- **退出码**：`0` = 无主要问题；`2` = 有主要问题；`1` = 扫描失败
- **不需要安装、不需要 API key**，纯静态规则（61 条），离线可跑
- 换行时可用 `--json` 拿结构化输出，便于逐条比对

**它查什么**：AI 生成界面常见的「套路味」——紫蓝渐变、到处 Inter 字体、
卡片嵌卡片、彩色底配灰字、纯黑纯灰、bounce 缓动、无意义装饰色条等。
与 A–E 组**互补**：A–E 管「符不符合本项目约定」，F 管「够不够专业、有没有 AI 味儿」。

## ⚠️ 规则冲突的裁决原则（用户 2026-09-28 定）

**本项目规矩优先。** 当 Impeccable 的报告与 `DESIGN_RULES.md` 冲突时：

1. **以 `DESIGN_RULES.md` 为准**，不因为外部工具报了就改。
2. Impeccable 的报告**只作「建议」列出**，交用户裁决，**不得自行修改**。
3. 用户裁决**保留**的，用行内注释就地豁免，并写清理由：

```css
.sentence-item.current {
  border-left: 3px solid #2f6fd0; /* impeccable-disable-line side-tab */
}
```

> 语法：`impeccable-disable-line <规则名>`（同一行）、`impeccable-disable-next-line`
> （下一行）、`impeccable-disable`（整个文件）。多个规则用逗号分隔，`*` 表示全部。
> **CSS 里必须写在同一行行尾**，写在上一行单独成行**不生效**（2026-09-28 实测）。

### 已裁决的冲突（不要反复重启讨论）

| 规则 | 冲突点 | 裁决 | 处置 |
|---|---|---|---|
| `side-tab` | 练习页「当前句」左侧 3px 蓝条，被判为 AI 味装饰 | **保留**（2026-09-28） | 已加行内豁免，理由：它是「练到第几句」的状态指示，非装饰；同项另有背景色变化作加强 |
| `overused-font` | 本项目用系统字体栈 | **未决** —— 待报出时交用户裁决 | — |
| 纯黑/纯灰 | 本项目用 `#1f2328` / `#626a74` 中性色 | **未决** | — |
| 卡片体系 | 本项目以卡片为主结构 | **未决** | — |

> 遇到新冲突：**先停下问用户**，不要自己选。选完把结论补进上表，避免下次重新讨论。

## G. 云服务部署（Day 15 起，2026-09-28）

第 3 周起项目联网。**改云函数、部署、调接口之前，先看这一组。**

### G1. 环境信息（不要写进代码，写进笔记）

| 项 | 值 |
|---|---|
| 环境 ID | `xingho-read-d0gamjt5d859dbd81` |
| 云函数地址 | `https://xingho-read-d0gamjt5d859dbd81.service.tcloudbase.com` |
| 静态托管地址 | `https://xingho-read-d0gamjt5d859dbd81-1497420413.tcloudbaseapp.com` |
| 地域 | `ap-shanghai` |

> ⚠️ **环境 ID 从截图上抄极易出错**（`t` 看成 `5`、`d` 看成 `x`，Day 15 实际发生过）。
> **正确做法：用 `tcb env list` 的输出确认，不要靠读图。**

### G2. ⚠️ 建新云函数：`cloudbaserc.json` 必须写 `type: "HTTP"`

**这是 Day 15 折腾了四轮才找到的坑，Day 16 建新函数时第一时间就要对。**

```json
{
  "version": "2.1",
  "functions": [{
    "name": "函数名",
    "type": "HTTP",
    "entry": "index.js",
    "gatewayPath": "/api/xxx",
    "public": true
  }]
}
```

| 现象 | 原因 |
|---|---|
| 公网报 `FunctionType parameter is invalid` | 函数被建成了 Event 型 |
| `tcb fn detail` 里「Execution method」为空、Triggers 为 None | 同上 |
| 命令行加了 `--httpFn` 也没用 | **`cloudbaserc.json` 优先级更高，会覆盖命令行参数** |
| 配置里写了 `handler: "index.main"` | ⚠️ **`handler` 是 Event 函数的字段**，写了就会被判定为 Event |

> **函数类型在创建时定死，后续更新改不了。建错只能删掉重建**（`tcb fn delete` + `tcb fn deploy`）。

### G3. 网关会剥掉路径前缀

`gatewayPath: "/api/health"` → 外部请求 `/api/health` 时，**函数内部收到的是 `/`**。

```
外部 /api/health       → 函数收到 "/"
外部 /api/health/test  → 函数收到 "/test"
```

→ **函数内部判断路由时按「剥掉前缀后」的路径写**。稳妥做法：两个都认（`/` 和 `/api/health`），
本地直连调试和线上就能跑同一份代码。

### G4. 两种函数类型的写法差异

| | Event 函数 | **HTTP 函数（本项目用这个）** |
|---|---|---|
| 入口 | `exports.main = (event, ctx) => {}` | `http.createServer()` + `server.listen(PORT)` |
| 端口 | 平台代管 | **必须从 `process.env.PORT` 读**，不能写死 9000 |
| 返回 | 返回对象 | `res.writeHead()` + `res.end()` |

### G5. 常用命令

```bash
tcb env list -e <envId>                          # 确认环境（也用来核对环境 ID）
tcb fn list -e <envId>                           # 函数列表
tcb fn detail <name> -e <envId>                  # 函数详情（查 Execution method）
tcb fn deploy <name> -e <envId>                  # 部署（配置写在 cloudbaserc.json，不用带参数）
tcb fn delete <name> -e <envId>                  # 删除
tcb hosting detail -e <envId>                    # 静态托管信息（拿公网域名）
tcb hosting deploy ./dist -e <envId> --verify    # 部署前端，带校验
```

> `tcb login` 已在 Day 15 由用户完成，后续不需要重复授权。
> **需要用户执行的命令一律用 CMD**（PowerShell 有执行策略限制，见项目记忆）。

### G6. 部署后必须用外部请求验证

**CLI 说「部署成功」只代表文件传上去了**，不代表能访问、能返回正确内容。
Day 15 就出现过「部署成功但公网报错」的情况。

```bash
curl -s "https://<envId>.service.tcloudbase.com/api/health"
```

### G7. 接口约定以 `api-contract.md` 为准

写接口前**先读 `api-contract.md`**，不要自己定字段。新增接口先在契约里登记占位，再实现。

### G8. ⚠️ 工具环境坑（Day 15 反复踩，务必先读）

**① Write 工具写 `/tmp/xxx` 会落到「当前盘符根目录」，不是 Git Bash 的临时目录**

Day 15 写 Playwright 脚本时踩到：脚本 `Write` 到 `/tmp/pwtest/x.mjs`，
实际落在 `D:\tmp\pwtest\x.mjs` —— 因为 Write 把 `/tmp` 当成了相对当前盘符的路径。
而 Bash 里的 `/tmp` 是 Git Bash 映射的 `C:\Users\<用户>\AppData\Local\Temp`。
两边指的不是同一个地方，于是「明明写了文件，`node` 却说找不到」。

**正确做法**：临时脚本一律用**完整 Windows 路径**，不要用 `/tmp`：

```
C:/Users/Administrator/AppData/Local/Temp/pwtest/xxx.mjs
```

**② Playwright 必须装在项目外的独立目录**

ESM（`.mjs`）**不认 `NODE_PATH`**，装在项目 `node_modules` 里会 `Cannot find module 'playwright'`。
固定用 `C:/Users/Administrator/AppData/Local/Temp/pwtest/`，
里面已有 `node_modules`（含 playwright + chromium），**直接复用，不要重装**。

**③ 项目目录里绝不留临时脚本**

Day 15 曾在项目根建了 `tmp-check-clear.mjs`，收尾时才发现并删除。
脚本一律写在上面那个项目外目录。

**④ 起开发服务器用完整路径的 node**

```bash
cd "D:/work place/vibe coding" && \
  (C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe \
   node_modules/vite/bin/vite.js --port 5173 > /tmp/vite.log 2>&1 &)
```

不要用 `npm run dev` —— PowerShell 执行策略会拦 `npm.ps1`（见项目记忆）。

## 报告格式（固定）

检查完**必须**按这个格式输出，不允许只说「已检查，没问题」：

```
## 约定自检报告

检查对象：<文件或功能>
依据：DESIGN_RULES.md / AGENTS.md / ...
外部体检：npx impeccable detect src/ → 退出码 N

| 分类 | 结果 | 说明 |
|---|---|---|
| A 技术栈 | 通过 / 不适用 / N 处不合规 | |
| B 设计规则 | | |
| C 可访问性 | | |
| D 交互反馈 | | |
| E 协作流程 | | |
| F 外部体检 | 通过 / N 处（含 M 处已裁决豁免） | |

不合规明细：
1. <文件:行号> —— <问题> —— <依据哪条规则>

F 组若与项目规则冲突：
- 冲突项 —— 我的判断（建议保留/建议改）—— **等你裁决**

修正建议：<改法>
```

**规则优先级的红线**（来自 `DESIGN_RULES.md` 第三节）：
> 任何一部分文字读不清，都比间距不齐严重。**对比度优先修。**

## 什么时候不要用本 Skill

- 只是问概念、聊天、看文件 —— 不需要走清单
- 做的是项目外的事
- 用户明确说了「别检查，直接改」

## 自我维护

- 规则变了（如 `DESIGN_RULES.md` 改了数值）→ **本文件不用改**，因为本文件不含具体数值
- 若发现本文件与项目文件**描述冲突**（例如说「不引入路由库」但 `TECH_DESIGN.md` 已允许）→ 以项目文件为准，并**立即修正本文件**
- 新增了一类反复要检查的规矩 → 补进上面的清单，而不是新增一个 Skill

## 已知的调用问题（2026-09-27 首次调用时发现）

**本 Skill 首次使用时未能被自动加载**，返回「找不到」。原因：

1. 技能发现机制在**会话启动时扫描一次**，之后只会查表，不再读磁盘；
2. 本项目 `.workbuddy-ai/` 目录与 `SKILL.md` 均**晚于会话启动**才创建，扫描时目录为空；
3. 项目级目录是否被纳入扫描范围，尚待验证。

**给未来的自己：**

- 要在新会话中使用本 Skill → **必须先建好目录与文件，再开新会话**
- 若新会话仍加载不了 → 迁移到用户级 `~/.workbuddy-ai/skills/xingho-conventions/`
- 加载不了时**不要停下**，按本文件的清单**手动执行**一遍，并在 `Skill调用记录.md` 留证
