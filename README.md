# XingHo Read

面向同学的英语口语跟读练习工具。把一段英文音频变成**能逐句听、逐句跟读、练完能打卡**的材料。

> **当前进度：Day 27 追加②（2026-10-14）**
>
> - **三个页面全部接真数据**（首页 / 新建页 / 练习页），不再有假数据
> - 后端 **8 个接口已上线**（云函数 + CloudBase PostgreSQL）
> - **音频方案定案**：音频文件放静态托管的 `audio/` 目录，材料里存地址
>   （本环境没有云存储桶，这是实测唯一可行的路径）
> - **48 条真实音频**已上传并建成材料（「星一班」文件夹，标题 `Lesson N · 第 M 条`）
> - 已部署上线，公网可访问（地址见第六节）
>
> 要做什么、做到什么程度算做到，见 `PRD.md`；用什么做、数据怎么走，见 `TECH_DESIGN.md`；
> 每日遗留问题见 `待办清单.md`。

---

## 一、运行环境

- **Node.js**：建议 20 以上（本机实测 v24.21.0）
- **浏览器**：Chrome / Edge 最新版
- 第一次安装依赖需要联网

---

## 二、第一次运行（只需做一次）

在项目目录下打开终端，执行：

```bash
npm install
```

作用：把 React、Vite 等依赖下载到本机的 `node_modules` 文件夹里。

> ⚠️ **Windows + PowerShell 的用户注意**：如果 `npm` 报「禁止运行脚本 … npm.ps1」，
> 跟 Node 装没装好**没关系**，是 PowerShell 默认不跑 `.ps1`。两种解法：
> ① 改用 **CMD** 执行；② 先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` 再用 PowerShell。

---

## 三、启动（每次开发都要做）

```bash
npm run dev
```

终端会输出类似这样：

```
VITE v8.3.0  ready in 327 ms

  ➜  Local:   http://localhost:5173/
```

然后在浏览器里打开 **http://localhost:5173** ，就能看到页面。

**要停止**：回到终端窗口，按 `Ctrl + C`。

---

## 四、其它命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器（改代码后页面会自动刷新） |
| `npm run build` | 把代码打包成正式版本，输出到 `dist/` |
| `npm run preview` | 在本地预览打包后的结果 |

前端打包后要发布到公网，用的是 CloudBase 的静态托管命令（不是本表的命令）：

```bash
tcb hosting deploy dist --safe --verify
```

⚠️ **绝对不要加 `--prune`** —— 它会删掉「不属于本次发布」的远端文件（连 `__auth/` 一起删）。
原因与完整发布/回滚流程见 `回滚手册.md`。

---

## 五、文件结构

```
vibe coding/
├── AGENTS.md          与 AI 协作的规则（最高优先级）
├── PRD.md             产品需求文档（做什么、做到什么程度算做到）
├── research.md        需求研究（同类产品对比、本期不做什么）
├── TECH_DESIGN.md     技术设计（数据流向、技术路线）
├── DESIGN_RULES.md    界面规范（色板、间距、组件规格，改样式前先看）
├── api-contract.md    接口契约（**字段以它为准**）
├── 架构说明.md         云函数四层架构说明
├── 待办清单.md         全项目遗留问题总表（每天开工先看；P5 存云端环境信息）
├── 回滚手册.md         什么情况必须回滚 + 四条回滚路径 + 实测耗时
├── 周验收表.md         逐项验收清单
├── 演示提纲.md         给别人演示时的讲法
├── Day14-用户测试记录.md  真人可用性测试的记录与结论
├── Skill调用记录.md    两个项目 Skill 的调用与改进记录
├── 方向变更说明.md      从「个人工具」到「班级工具」的方向变更记录
├── README.md          本文件（运行说明）
├── index.html         页面入口
├── vite.config.js     Vite 配置
├── package.json       依赖清单与命令
├── cloudbaserc.json   云端配置（⚠️ 必须写 "type": "HTTP"）
├── cloudbaserc.local.json   本地部署配置（含密钥，**已被 git 忽略，不会提交**）
├── db/
│   ├── schema.sql           建表脚本
│   ├── seed.sql             种子数据（可重复执行）
│   ├── audio-upload-map.tsv 48 条音频的上传对照表（课号/序号/云端文件名/时长）
│   └── audio-material-ids.json  材料 id 对照（上传后建的）
├── cloudfunctions/
│   └── health/        云函数（**Web 函数**，四层架构，零依赖）
│       ├── index.js        接口层：路由 + 参数校验 + 返回
│       ├── repo.js         数据访问层：拼装查询与写入
│       ├── db.js           数据库客户端：只跟 CloudBase HTTP API 说话
│       ├── http-utils.js   通用工具（读请求体、返回 JSON）
│       ├── package.json
│       └── scf_bootstrap  启动入口
├── .workbuddy-ai/
│   └── skills/        两个项目 Skill（见第八节）
└── src/
    ├── main.jsx       程序入口
    ├── App.jsx        应用外壳（哈希路由 + 取练习页数据）
    ├── useHashRoute.js  手写路由（不引路由库）
    ├── api.js         所有接口调用集中在这里
    ├── styles.css     全部样式（手写 CSS）
    └── pages/
        ├── Home.jsx         首页（文件夹 + 材料，已接真数据）
        ├── NewMaterial.jsx  新建页（文件夹/标题/音频地址/文本，真保存）
        └── Practice.jsx     练习页（逐句播放 + 单句循环 + 跟读录音）
```

> `dist/` 与 `node_modules/` 是构建产物和依赖，已在 `.gitignore` 里，不提交。

---

## 六、关于数据（重要）

本项目**不是纯前端应用**：数据存在**腾讯云 CloudBase** 上。

| 层 | 是什么 | 在哪 |
|---|---|---|
| **前端** | React + Vite，只负责界面 | 静态托管 |
| **后端** | CloudBase **云函数**（HTTP 型 / Web 函数），提供 `/api/*` 接口 | 云函数 `health` |
| **数据库** | CloudBase **PostgreSQL**，三张表：`folders` / `materials` / `sentences` | SQL 型数据库（PG 模式） |

### 已上线的 8 个接口

| 接口 | 方法 | 干什么 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/folders` | GET / POST | 查文件夹列表（带材料数）/ 新建文件夹 |
| `/api/folders/<id>` | PATCH / DELETE | 改名 / 删除文件夹 |
| `/api/materials` | GET / POST | 查材料列表 / 新建材料（可同时建句段） |
| `/api/materials/<id>` | GET | 查单条材料 + 它的句段（练习页用） |

字段、错误码、失败分支的完整说明见 `api-contract.md`（**以后端那份为准**，本表只是索引）。

### 音频怎么放（Day 27 定案）

- **一条材料只有 1 个音频文件**（`materials.audio_url`）。
  「句段」不是切成一个个小文件，而是**在这一个文件里的时间段**（`sentences.start_ms` / `end_ms`）。
  播放第 3 句 = 把播放位置跳到 `start_ms/1000` 秒，播到 `end_ms/1000` 停。
- **上传方式**：本环境**没有云存储桶**，托管桶也不挂存储 API，实测唯一可行的路径是命令行：
  ```bash
  tcb hosting deploy "音频.mp3" audio/材料名.mp3
  ```
  得到 `https://<托管地址>/audio/材料名.mp3`，粘到新建页的「音频地址」。
  48 条星一班音频就是这样传的，对照表在 `db/audio-upload-map.tsv`。
- **没有句段的材料也能整段播放**：播放按钮只看「有没有音频」；「有没有句段」只决定能不能逐句。

### 线上地址

| | 地址 |
|---|---|
| 静态托管（网页） | `https://xingho-read-d0gamjt5d859dbd81-1497420413.tcloudbaseapp.com/` |
| 云函数（接口） | `https://xingho-read-d0gamjt5d859dbd81.service.tcloudbase.com` |

> 换浏览器、换电脑都能看到同一份数据；代价是**需要联网** —— 断网时读不到数据。
> 「断开网络后仍可见」这条 PRD 验收标准已登记为待办 **P0-4c**。

---

## 七、常见问题

**① 提示 `Port 5173 is already in use`（端口被占用）**

说明上一次的开发服务器还在跑。回到那个终端按 `Ctrl + C` 停掉；或者临时换个端口启动：

```bash
npm run dev -- --port 5174
```

**② 提示 `npm 不是内部或外部命令`**

说明 Node.js 没装好，或者没加进系统 PATH。重装 Node.js 并勾选「Add to PATH」。

**③ 页面打开是空白的**

先看终端里有没有红色报错；再按 `F12` 打开浏览器控制台，看 Console 里的报错信息。

**④ 页面能打开，但显示「读取失败」/ 数据是旧的**

先按 `F12` 看 Network 里 `/api/*` 请求的状态码与返回体，再到 `api-contract.md`
查这个状态码对应的错误码含义；仍然定位不了，就手动打一次线上健康检查
（`curl https://<云函数地址>/api/health`）—— 它通说明问题在前端，不通说明在后端。

---

## 八、两份项目 Skill

项目里有两个可复用的自检清单，都在 `.workbuddy-ai/skills/` 下：

| Skill | 什么时候用 | 查什么 |
|---|---|---|
| **xingho-conventions** | **动手改代码 / 样式 / 产品文档之前** | 技术栈约束、设计规则、无障碍、协作流程 |
| **xingho-release-check** | **推到公网之前 / 部署后确认 / 一天收尾准备提交时** | R0–R5 六组共 18 项 |

### release-check 的六组

| 组 | 查什么 |
|---|---|
| **R0 红线** | 密钥没进仓库 / `.gitignore` 覆盖敏感文件 / 工作区干净且已推送 |
| R1 构建 | 前端能构建 / 后端语法正确 |
| R2 后端线上 | 健康检查 / 读接口 / **写操作四类闭环** / 错误提示是中文 / 环境变量还在 |
| R3 前端线上 | 公网首页 200 / 资源齐全 / **线上 JS = 本地构建的 JS** / 浏览器实测 |
| R4 数据卫生 | 库里没有测试残留 / 远端没有备份垃圾 |
| R5 文档 | `待办清单.md` 头行是今天 / 契约 = 实际路由 |

### 怎么用

1. 直接说「**跑一遍发布前检查**」，或
2. 手动打开 `SKILL.md`，按清单**逐条执行** ——
   ⚠️ **项目级 Skill 目录当前不会被自动扫描到**（只认用户级 `~/.workbuddy-ai/skills/`）。
   这时不要停下，手动执行一遍即可，原因与处置见 `Skill调用记录.md` 与待办 **P3-13**。

### 两条要点

- **红线优先**：R0 任何一条不过 → 结论就是「**不许发布**」，不得因为「其他都过了」就放行。
- **不抄具体数值**：Skill 里**不写**「库里应该有 5 个文件夹」这类数字，
  只写「查什么、用什么命令、什么算通过」。理由见 `SKILL.md` 的「铁律一」——
  写死了数字，将来合法变更就会让它变成一份**说谎的文件**。

---

## 九、想找什么，去查哪份文档

| 想知道 | 查这份 |
|---|---|
| 这个功能到底要不要做、做到什么程度 | `PRD.md` |
| 接口字段、错误码、失败分支 | `api-contract.md` |
| 数据怎么流、为什么这么做 | `TECH_DESIGN.md` |
| 云函数四层分别负责什么 | `架构说明.md` |
| 颜色 / 间距 / 按钮高度能不能这么写 | `DESIGN_RULES.md` |
| 云端环境信息（环境 ID、地址、套餐） | `待办清单.md` 的 **P5** |
| 出事故了怎么回滚 | `回滚手册.md` |
| 还有哪些事没做、优先级 | `待办清单.md` |
| 真人测试发现过什么问题 | `Day14-用户测试记录.md` |
| 和 AI 协作的规矩 | `AGENTS.md` |
