import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表。
 *
 * 约定：
 *  · history 模式（不是 hash）—— 这是预渲染与「URL 干净可分享」的前提（ADR-13）
 *  · 参数化路由的 id 由「两段」拼成：`/compare/:topicId/:chapterSlug` → `basics/01-variables`
 *    这样 chapterId / featureId 里的 `/` 就能自然地表达成路径分隔，无需 catch-all 参数
 *  · `/search` 首期只是占位，**不进导航**（避免死链接）
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/lang/:langId',
    name: 'language',
    component: () => import('@/views/LanguageView.vue'),
  },
  {
    path: '/compare/:topicId/:chapterSlug',
    name: 'chapter',
    component: () => import('@/views/ChapterCompareView.vue'),
  },
  {
    path: '/feature/:topicId/:slug',
    name: 'feature',
    component: () => import('@/views/FeatureView.vue'),
  },
  {
    path: '/pitfalls',
    name: 'pitfalls',
    component: () => import('@/views/PitfallsView.vue'),
  },
  {
    path: '/glossary',
    name: 'glossary',
    component: () => import('@/views/GlossaryView.vue'),
  },
  {
    path: '/roadmap/:langId',
    name: 'roadmap',
    component: () => import('@/views/RoadmapView.vue'),
  },
  {
    path: '/attributions',
    name: 'attributions',
    component: () => import('@/views/AttributionsView.vue'),
  },
  {
    path: '/search',
    name: 'search',
    // 首期不做搜索，仅占位。不放进 sitemap（manifest.routes 里没有它）
    component: () => import('@/views/SearchView.vue'),
  },
  {
    path: '/404',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404',
  },
]
