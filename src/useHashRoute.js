// 哈希路由（Day 13）
//
// 为什么不用路由库：TECH_DESIGN 第四节写明「不引入路由库」，
// 而本期只需要「地址栏能对应视图、刷新不丢、后退键能用」这三件事，
// 手写 40 行就够 —— 引库反而是为了 10% 的功能背 100% 的体积。
//
// 哈希（地址里 # 后面的部分）有个关键特性：
// 变化时**页面不会重新加载**，但会触发 hashchange 事件。
// 这正好是「无刷新换页」要的效果。
//
// 路由表：
//   #/            首页
//   #/new         新建材料
//   #/practice/1  练习页，第 1 条材料（带 id）

import { useEffect, useState } from 'react'

// 把地址栏的哈希解析成一个「路由对象」。
// 所有「地址长什么样 → 该显示什么」的判断都收敛在这里，别处只读结果。
export function parseHash(hash) {
  // 先砍掉哈希里出现的 '?' 及其后面所有内容。
  //
  // 为什么要砍：有人会写成 '#/practice/1?state=loading'。
  // 但整段 '1?state=loading' 会被当成 id，导致「找不到材料 1?state=loading」。
  // 查询参数的正确位置是 **'#' 之前**：
  //     ✅ /?state=loading#/practice/1
  //     ❌ /#/practice/1?state=loading
  // 砍掉之后 '#/practice/1?state=loading' 也能正确解析出 id='1'，容错而不报错。
  const withoutQuery = hash.split('?')[0]

  // 去掉开头的 '#' 与 '/'，再按 '/' 拆开
  // '#/practice/1'  →  ['practice', '1']
  // '#/' 或 ''      →  []
  const path = withoutQuery.replace(/^#\/?/, '')
  const parts = path ? path.split('/').filter(Boolean) : []

  const head = parts[0] || 'home'

  if (head === 'new') return { name: 'new', id: null }
  if (head === 'practice') return { name: 'practice', id: parts[1] || null }
  return { name: 'home', id: null }
}

// 读当前地址对应的路由
function readRoute() {
  return parseHash(window.location.hash)
}

// 监听地址变化。用户点导航、按后退键、手打地址，都会走到这里。
export function useHashRoute() {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    function handleChange() {
      setRoute(readRoute())
    }
    // 浏览器前进 / 后退、手动改地址，都会触发 hashchange
    window.addEventListener('hashchange', handleChange)
    return () => window.removeEventListener('hashchange', handleChange)
  }, [])

  return route
}

// 导航：改地址栏哈希。
//
// ⚠️ 必须用赋值（location.hash = ...），不能用 location.replace()。
//    赋值会往历史栈里压一条记录 → 后退键能回到上一页；
//    replace 会覆盖当前记录 → 后退键会跳过它。
export function navigate(hash) {
  if (window.location.hash === hash) return
  window.location.hash = hash
}

// 各视图的地址（避免在 JSX 里散落字符串）
export const ROUTES = {
  home: '#/',
  new: '#/new',
  practice: '#/practice',
}

// 练习页的地址：带材料 id 才有意义 —— 刷新后能靠这个 id 把材料重新找回来
export function practicePath(id) {
  return id == null ? ROUTES.practice : `#/practice/${id}`
}
