// XingHo Read —— 应用外壳
//
// Day 13 改造：页面切换由「内存状态」改为「地址栏哈希」。
//
// 为什么值得改（Day 13 板块①）：
//   旧做法 useState 只改内存，地址栏不动 → 刷新回首页、不能直达、不能分享、后退键无效。
//   改成哈希后这四件事都能做，而且没引路由库（TECH_DESIGN 第四节）。
//
// 路由表与解析见 src/useHashRoute.js。

import Home from './pages/Home.jsx'
import NewMaterial from './pages/NewMaterial.jsx'
import Practice from './pages/Practice.jsx'
import { ROUTES, practicePath, useHashRoute } from './useHashRoute.js'
import { findMaterialById } from './mock/homeData.js'

// 导航标签：可访问性（Skill C 组）
//   ① 用 <nav> 而不是 <div>，屏幕阅读器才知道这是导航区
//   ② 用 <a href> 而不是 <button>：地址会被浏览器原生支持（中键新开标签、右键复制链接）
//   ③ aria-current="page" 告诉辅助技术「这是当前所在的页面」
const NAV_ITEMS = [
  { key: 'home', label: '首页', hash: ROUTES.home },
  { key: 'new', label: '新建', hash: ROUTES.new },
  { key: 'practice', label: '练习', hash: ROUTES.practice },
]

export default function App() {
  const route = useHashRoute()

  // 练习页要显示哪条材料？由地址里的 id 决定（二级路由）。
  // 找不到了（例如手打 #/practice/999）返回 null，交给 Practice 显示「找不到这条材料」。
  const currentMaterial =
    route.name === 'practice' && route.id ? findMaterialById(route.id) : null

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="brand">XingHo Read</h1>

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
      </header>

      <Breadcrumb route={route} material={currentMaterial} />

      <main className="app-main">
        {route.name === 'home' && <Home />}
        {route.name === 'new' && <NewMaterial />}
        {route.name === 'practice' && (
          <Practice material={currentMaterial} materialId={route.id} />
        )}
      </main>
    </div>
  )
}

// 面包屑（余力加练项）
// 作用：让用户随时知道「我在哪一层」，并且每一层都能点回去。
// 用 <nav> + <ol>：ol 表示有顺序层级，屏幕阅读器会念「第 2 项，共 3 项」。
function Breadcrumb({ route, material }) {
  const items = [{ label: '首页', hash: ROUTES.home }]

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
