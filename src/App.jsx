// XingHo Read —— 应用外壳
//
// Day 13 改造：页面切换由「内存状态」改为「地址栏哈希」。
//
// 为什么值得改（Day 13 板块①）：
//   旧做法 useState 只改内存，地址栏不动 → 刷新回首页、不能直达、不能分享、后退键无效。
//   改成哈希后这四件事都能做，而且没引路由库（TECH_DESIGN 第四节）。
//
// 路由表与解析见 src/useHashRoute.js。

import { useCallback, useEffect, useState } from 'react'
import Home from './pages/Home.jsx'
import NewMaterial from './pages/NewMaterial.jsx'
import Practice from './pages/Practice.jsx'
import { ROUTES, practicePath, useHashRoute } from './useHashRoute.js'
import { fetchMaterial } from './api.js'

// 应用版本号（Day 26）
//
// 为什么要写在界面上：发布后要能一眼回答「公网上跑的到底是哪一版」。
// 回退演练时全靠它判断「现在是坏版本还是好版本」——
// 没有它就只能靠肉眼比对页面内容，不可靠。
//
// 抽成常量：板块③要造一个「坏版本 v1.1」，只需改这一行，不用到处找。
const APP_VERSION = 'v1.0'

// 导航标签：可访问性（Skill C 组）
//   ① 用 <nav> 而不是 <div>，屏幕阅读器才知道这是导航区
//   ② 用 <a href> 而不是 <button>：地址会被浏览器原生支持（中键新开标签、右键复制链接）
//   ③ aria-current="page" 告诉辅助技术「这是当前所在的页面」
const NAV_ITEMS = [
  { key: 'home', label: '材料库', hash: ROUTES.home },
  { key: 'new', label: '新建材料', hash: ROUTES.new },
  { key: 'practice', label: '练习', hash: ROUTES.practice },
]

export default function App() {
  const route = useHashRoute()

  // 练习页要显示哪条材料？由地址里的 id 决定（二级路由）。
  //
  // 【Day 27 改成异步】原来这里调 `findMaterialById`（读本地 mock，立刻有结果）。
  //   接真数据后要**等网络**，于是多出三种以前不存在的情况：
  //     正在读 / 读失败 / 读回来发现没这条（id 不存在）
  //   这三种要分别显示不同的话，所以状态由这个 hook 统一管。
  //
  // ⚠️ 为什么放在 App 而不是 Practice 里：**面包屑也要用材料标题**。
  //    如果只在 Practice 里取，面包屑就拿不到标题，只能显示「材料 3」。
  const practice = usePracticeMaterial(route.name === 'practice' ? route.id : null)

  return (
    <div className={`app route-${route.name}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        跳到主要内容
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href={ROUTES.home}>
            <img className="brand-mark" src="/xingho-mark.png" alt="" width="48" height="48" />
            <span className="brand-copy">
              <strong className="brand-name">XingHo Read</strong>
              <span className="brand-tagline">英语跟读练习</span>
            </span>
          </a>

          <nav className="nav" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.key}
                className={route.name === item.key ? 'nav-btn active' : 'nav-btn'}
                href={item.hash}
                aria-current={route.name === item.key ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <Breadcrumb route={route} material={practice.material} />

      <main className="app-main" id="main-content" tabIndex={-1}>
        {route.name === 'home' && <Home />}
        {route.name === 'new' && <NewMaterial />}
        {route.name === 'practice' && (
          <Practice
            status={practice.status}
            material={practice.material}
            errorMessage={practice.errorMessage}
            materialId={route.id}
            onRetry={practice.reload}
          />
        )}
      </main>

      {/* 页脚版本标识（Day 26）：发布后靠它确认公网跑的是哪一版 */}
      <footer className="app-footer">
        <div className="footer-inner">
          <span className="footer-brand">每天一点，让开口成为习惯。</span>
          <span className="app-version">XingHo Read {APP_VERSION}</span>
        </div>
      </footer>
    </div>
  )
}

// ── 取练习页要用的那条材料（Day 27 新增）──────────────────────
//
// 【为什么单独抽成一个 hook】
//   练习页的状态从「同步查 mock」变成「异步问服务器」之后，
//   多出了三件必须处理的事：竞态、卸载后 setState、重新读取。
//   三件事都写进组件里会把业务逻辑淹掉，所以抽出来。
//
// 【status 的四种取值 —— 它们要显示的文案完全不同】
//   'idle'      地址里没写 id（#/practice）→ 「这个地址没有指定要练哪条材料」
//   'loading'   正在读
//   'not-found' 服务器明确回了 404      → 「列表里没有编号为 3 的材料」
//   'error'     网络断了 / 服务出错     → 「读取失败」+ 给「重新读取」
//   'ready'     读到了
//
//   ⚠️ **'not-found' 和 'error' 必须分开**：前者是「这条材料不存在」（链接失效，
//      换个材料就好），后者是「现在读不到」（重试可能就好了）。
//      合并成一种，用户会去做错误的下一步 —— 这是 Day 14「沉默的失败」同一类问题。
//
// @param {string|null} materialId
function usePracticeMaterial(materialId) {
  const [state, setState] = useState({ status: 'idle', material: null, errorMessage: '' })
  const [attempt, setAttempt] = useState(0) // 变化一次 = 重新读一次

  useEffect(() => {
    if (!materialId) {
      setState({ status: 'idle', material: null, errorMessage: '' })
      return
    }

    // 【为什么需要 cancelled】
    //   用户在「材料 1 → 材料 2 → 材料 3」之间快速点击时，几个请求会同时在路上。
    //   谁先回来不一定（网络顺序不保证）—— 如果不作废旧的，
    //   可能「材料 1」的响应最后到，把「材料 3」的内容盖上去。
    //   这叫竞态条件，表现是「页面显示的材料和地址栏的 id 对不上」。
    let cancelled = false

    setState({ status: 'loading', material: null, errorMessage: '' })

    fetchMaterial(materialId)
      .then((data) => {
        if (cancelled) return
        setState({ status: 'ready', material: data.material, errorMessage: '' })
      })
      .catch((err) => {
        if (cancelled) return
        // 用**状态码**判断，不用中文文案（见 api.js 的说明）
        const notFound = err.status === 404
        setState({
          status: notFound ? 'not-found' : 'error',
          material: null,
          errorMessage: err.message,
        })
      })

    return () => {
      cancelled = true
    }
  }, [materialId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { ...state, reload }
}

// 面包屑（余力加练项）
// 作用：让用户随时知道「我在哪一层」，并且每一层都能点回去。
// 用 <nav> + <ol>：ol 表示有顺序层级，屏幕阅读器会念「第 2 项，共 3 项」。
function Breadcrumb({ route, material }) {
  const items = [{ label: '材料库', hash: ROUTES.home }]

  if (route.name === 'new') items.push({ label: '新建材料', hash: ROUTES.new })
  if (route.name === 'practice') {
    if (route.id) items.push({ label: '练习', hash: ROUTES.practice })
    // 最后一项：找到材料就显示标题，没找到就显示 id
    if (material) items.push({ label: material.title, hash: practicePath(material.id) })
    else if (route.id) items.push({ label: `材料 ${route.id}`, hash: null })
    else items.push({ label: '练习', hash: ROUTES.practice })
  }

  // 首页时面包屑只有「首页」一项，没有意义，不显示
  if (items.length === 1) return null

  return (
    <div className="crumb-bar">
      <nav className="crumb" aria-label="当前位置">
        <ol className="crumb-list">
          {items.map((item, i) => {
            const isLast = i === items.length - 1
            return (
              <li key={i} className="crumb-item">
                {isLast || !item.hash ? (
                  <span className="crumb-current" aria-current="page">
                    {item.label}
                  </span>
                ) : (
                  <a className="crumb-link" href={item.hash}>
                    {item.label}
                  </a>
                )}
                {!isLast && (
                  <span className="crumb-sep" aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* 返回上一页（余力加练项）：走浏览器历史，回到真正来过的那个页面。
          首页视为栈底，没有上一页，按钮禁用。 */}
      <BackButton isRoot={route.name === 'home'} />
    </div>
  )
}

function BackButton({ isRoot }) {
  return (
    <button
      type="button"
      className="btn btn-small crumb-back"
      onClick={() => window.history.back()}
      disabled={isRoot}
    >
      返回上一页
    </button>
  )
}
