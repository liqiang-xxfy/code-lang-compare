import type { RouteRecordRaw } from 'vue-router'
import {
  landingSection,
  orderedSections,
  pairTargetsOf,
  sectionIsChapter,
  sectionPathOf,
  visibleChaptersOf,
} from '@/content/repository'
import { enabledLanguageIds } from '@/generated/registry.gen'
import { isSectionId } from '@/generated/sections.gen'
import type { Section } from '@/schemas'

/**
 * 是不是一个已注册的板块。
 *
 * 名单来自 `content/registry.yaml` 的 sections 段（构建期生成到 sections.gen.ts），
 * 不再是写死的数组 —— 加板块不需要改这里。
 */
export const isSection = (v: string): v is Section => isSectionId(v)

/**
 * 路由 → 板块。
 *
 * 路由参数化之后板块就在 `params.section` 里 —— 逐个 `switch (route.name)`
 * 列举具名路由的写法，加板块必然漏一处，而漏了不报错。
 */
export function sectionOfRoute(route: { params: Record<string, unknown> }): Section | null {
  const raw = route.params.section
  return typeof raw === 'string' && isSectionId(raw) ? raw : null
}

export const isEnabledLanguage = (v: string): boolean =>
  (enabledLanguageIds as readonly string[]).includes(v)

/**
 * 板块入口：落到该板块的第一个可用页面。
 *
 * 只在**没有 store 可用**的场合调用（路由的 redirect 函数）。
 * 章节型取「在**该基准自己的**章节列表里，第一个它确实写了内容的章」——
 * 章节分类每个基准各一份，而且某个基准可能还没写某一章的内容，落到那里会是一页空白。
 */
export function sectionEntryPath(baseline: string, section: Section): string {
  if (sectionIsChapter(section)) {
    const first = visibleChaptersOf(baseline, section)[0]
    return first ? `/compare/${baseline}/${section}/${first.id}` : '/404'
  }
  return pairTargetsOf(baseline, section).length ? sectionPathOf(baseline, section) : '/404'
}

/**
 * `/compare/<基准>` 与顶栏「多语言对比」的落点。
 *
 * 从**落点板块**（registry 里的 `landing: true`）起找，找不到就顺着 order 往后走：
 * 骨架期某个基准可能还没有落点板块的内容，直接取落点板块会得到一页空白。
 *
 * 落点只决定**板块**，方向由随后的路由守卫解析（这里够不到 store）——
 * 守卫会用 `resolvePairTarget` 尊重「上次挑的方向」，取法与 `sectionEntryPath`
 * 的兜底同口径。
 */
export function compareEntryPath(baseline: string): string {
  const landing = landingSection()
  const all = orderedSections().map((s) => s.id)
  const candidates = landing ? [landing, ...all.filter((id) => id !== landing)] : all
  for (const id of candidates) {
    const path = sectionEntryPath(baseline, id)
    if (path !== '/404') return path
  }
  return '/404'
}

/**
 * 路由表。
 *
 * 约定：
 *  · history 模式（不是 hash）—— 这是预渲染与「URL 干净可分享」的前提（ADR-13）
 *  · **基准进 URL**：每个基准是一套独立的浏览语境，要能预渲染、能分享
 *  · **目标语言不进 URL**：它是"我现在想看哪个方向"，由每个板块页内的选择条决定。
 *    写进地址会让同一份内容散成十几个地址，并让章节页（列 = 基准 + 多选）
 *    与速查页（一门目标 = 一篇文章）出现两套互不相容的 URL 语义
 *  · 参数化路由把全局 feature id 里的 `/` 表达成路径分隔，无需 catch-all 参数
 *  · **旧地址不保留重定向**：v1 的两段地址（`/compare/<topicId>/<slug>`）、
 *    `/pitfalls`、`/glossary`、`/roadmap/<语言>` 一律 404。静态托管做不了 301，
 *    为过渡地址预渲染一堆外壳是纯粹的负担。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },

  /*
   * ── 多语言对比：板块页 ──
   *
   * 两条参数化路由。板块不在路由名里，它是 `params.section` ——
   * 由 SectionDispatchView 按注册表的 shape 选渲染器。加板块不需要在这里加东西。
   *
   * 4 段 = 章节型（`/compare/<基准>/<板块>/<章节>`）；
   * 3 段 = 列表型板块自己的落点，或章节型板块的入口（守卫分流）。
   */
  {
    path: '/compare/:baseline/:section/:chapter',
    name: 'compare-chapter',
    component: () => import('@/views/SectionDispatchView.vue'),
  },
  {
    path: '/compare/:baseline/:section',
    name: 'compare-section',
    component: () => import('@/views/SectionDispatchView.vue'),
  },
  {
    path: '/compare/:baseline',
    name: 'compare-entry',
    redirect: (to) => compareEntryPath(String(to.params.baseline)),
  },

  /* ── 语言入口与特性详情 ── */
  {
    path: '/lang/:langId',
    name: 'language',
    component: () => import('@/views/LanguageView.vue'),
    props: true,
  },
  {
    // 全局 feature id 是 `<板块>/<feature>` 两段 —— feature 属于池，与基准无关
    path: '/feature/:section/:feature',
    name: 'feature',
    component: () => import('@/views/FeatureView.vue'),
    props: true,
  },

  {
    path: '/search',
    name: 'search',
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
