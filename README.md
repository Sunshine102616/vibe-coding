# XingHo Read

面向同学的英语口语跟读练习工具。把一段英文音频变成**能逐句听、逐句跟读、练完能打卡**的材料。

> **当前进度：Day 7 骨架版** —— 三个页面的界面已就位，真实功能尚未接通。
> 要做什么、做到什么程度算做到，见 `PRD.md`；用什么做、数据怎么走，见 `TECH_DESIGN.md`。

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

---

## 五、文件结构

```
vibe coding/
├── AGENTS.md          与 AI 协作的规则
├── PRD.md             产品需求文档（做什么、做到什么程度算做到）
├── research.md        需求研究（同类产品对比、本期不做什么）
├── TECH_DESIGN.md     技术设计（数据流向、技术路线）
├── README.md          本文件（运行说明）
├── index.html         页面入口
├── vite.config.js     Vite 配置
├── package.json       依赖清单与命令
└── src/
    ├── main.jsx       程序入口
    ├── App.jsx        应用外壳（三个页面之间的切换）
    ├── styles.css     全部样式（手写 CSS）
    └── pages/
        ├── Home.jsx         首页
        ├── NewMaterial.jsx  新建页
        └── Practice.jsx     练习页
```

---

## 六、关于数据（重要）

本项目是**纯前端**应用：**没有服务器、没有账号，数据只存在你自己的浏览器里**。

- 好处：全程不经过任何服务器，别人看不到；断网也能用
- 代价：清理浏览器数据、换浏览器或换电脑，材料会丢失

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
