import { useState } from 'react'
import Home from './pages/Home.jsx'
import NewMaterial from './pages/NewMaterial.jsx'
import Practice from './pages/Practice.jsx'

// XingHo Read —— 应用外壳
// 负责两件事：① 在三个页面之间切换；② 记住「当前打开的是哪条材料」。
// 页面切换先用 React 自带的 useState 手写，不引入路由库（TECH_DESIGN 第四节）。
export default function App() {
  const [page, setPage] = useState('home')
  const [currentMaterial, setCurrentMaterial] = useState(null)

  function openMaterial(material) {
    setCurrentMaterial(material)
    setPage('practice')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="brand">XingHo Read</h1>
        <nav className="nav">
          <button
            className={page === 'home' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('home')}
          >
            首页
          </button>
          <button
            className={page === 'new' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('new')}
          >
            新建
          </button>
          <button
            className={page === 'practice' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('practice')}
          >
            练习
          </button>
        </nav>
      </header>

      <main className="app-main">
        {page === 'home' && (
          <Home onOpenMaterial={openMaterial} onGoNew={() => setPage('new')} />
        )}
        {page === 'new' && <NewMaterial onBack={() => setPage('home')} />}
        {page === 'practice' && (
          <Practice material={currentMaterial} onBack={() => setPage('home')} />
        )}
      </main>
    </div>
  )
}
