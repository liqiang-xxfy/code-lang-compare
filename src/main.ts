/**
 * 应用入口。
 *
 * 用 `ViteSSG` 而不是 `createApp`：构建期由 vite-ssg 调用这个工厂，
 * 对 manifest 里的每条路由渲染出**含真实内容的静态 HTML**（D-B / ADR-13）。
 * 爬虫（尤其不执行 JS 的百度）直接读 HTML 就能拿到对照内容。
 *
 * 客户端不启用 hydration 而是全新挂载（vite-ssg 默认）：
 * 我们不做「静态 HTML 与客户端状态逐节点比对」，因此不会出现 hydration mismatch
 * 之类的脆弱问题；代价是首帧后有一次替换 —— 对内容站是可接受的取舍。
 */
import { createPinia } from 'pinia'
import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { routes } from './router'
import { installGuards } from './router/guards'
import './styles/tokens.css'
import './styles/base.css'

export const createApp = ViteSSG(
  App,
  {
    routes,
    base: import.meta.env.BASE_URL,
    scrollBehavior(to, _from, savedPosition) {
      if (savedPosition) return savedPosition
      /*
       * 带锚点时定位到目标元素。
       * 搜索结果会链到 `/pitfalls#pitfall-xxx`、`/glossary#term-xxx` 这类地址 ——
       * 跳过去之后停在页面顶部、还要用户自己找，是「搜得到但找不到」的典型失败。
       * top: 76 是为了避开吸顶的 header。
       */
      if (to.hash) return { el: to.hash, top: 76, behavior: 'smooth' }
      return { top: 0 }
    },
  },
  ({ app, router }) => {
    const pinia = createPinia()
    app.use(pinia)
    if (router) installGuards(router, pinia)
  },
)
