import type { RouteRecordRaw } from 'vue-router'
import {
  getPair,
  landingSection,
  manifest,
  orderedSections,
  pairTargetsOf,
  sectionFirstChapterPath,
  sectionIsChapter,
  sectionPathOf,
} from '@/content/repository'
import {
  defaultBaselineLanguageId,
  defaultCompareLanguageId,
  enabledLanguageIds,
} from '@/generated/registry.gen'
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
 * 路由参数化之后板块就在 `params.section` 里。此前那版逐个 `switch (route.name)`
 * 列举五条具名路由 —— 加板块必然漏一处，而漏了不报错。
 * 调用方：App 的路由 watcher（写回 store）、useBaselineSwitch（换基准后落到哪）、
 * 左侧菜单（高亮当前板块）。
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
 * 只在**没有 store 可用**的场合调用（路由的 redirect 函数）。对级板块的
 * 目标语言由页内的对比语言选择条决定，这里的取法是确定性的"第一个有内容的方向"，
 * 与 [resolvePairTarget](src/content/repository.ts) 的兜底分支一致。
 */
export function sectionEntryPath(baseline: string, section: Section): string {
  // 章节型落到首章，列表型落到板块根地址 —— 判据是板块的 shape，不是「它是不是 basics」
  if (sectionIsChapter(section)) return sectionFirstChapterPath(section, baseline) ?? '/404'
  return pairTargetsOf(baseline, section).length ? sectionPathOf(baseline, section) : '/404'
}

/**
 * `/compare/<基准>` 与顶栏「多语言对比」的落点。
 *
 * 从**落点板块**（registry 里的 `landing: true`）起找，找不到就顺着 order 往后走：
 * 骨架期某个基准可能还没有落点板块的内容（例如某基准没有 roadmap 方向），
 * 直接取落点板块会得到一页空白。
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

/** 旧 topic id → 新地址。`basics` 是唯一改过名的（它从语言无关变成"某基准下的"）。 */
export function legacyTopicPath(topicId: string, slug: string): string {
  // `basics` 单独处理：它是唯一改过名的旧 topic（从「语言无关」变成「某基准下的」）
  if (topicId === 'basics') {
    const exists = manifest.topics
      .find((t) => t.section === 'basics' && t.baseline === defaultBaselineLanguageId)
      ?.chapters.some((c) => c.id.split('/')[1] === slug)
    return exists ? `/compare/${defaultBaselineLanguageId}/basics/${slug}` : '/404'
  }
  const cfg = manifest.topics.find((t) => t.id === topicId)
  if (!cfg) return '/404'
  // 旧地址只可能落在章节型板块上（列表型板块从来没有过自己的 topic 目录）
  return sectionIsChapter(cfg.section) ? `/compare/${cfg.baseline}/${cfg.section}/${slug}` : '/404'
}

/** 旧 topic id 对应的目标语言，供守卫把它并进全局选择（地址里已经不带它了） */
export function legacyTopicTarget(topicId: string): string | null {
  return manifest.topics.find((t) => t.id === topicId)?.target ?? null
}

/**
 * 旧路线图地址（`/roadmap/<目标语言>`）→ 新地址。
 *
 * 旧语义是「从固定参照系（JavaScript）出发学目标语言」，所以默认基准就是出发端；
 * `langId` 恰好是默认基准时（从自己学自己没意义）回落到默认对比语言。
 * 新地址里没有目标语言，所以调用方还要顺手把目标并进全局选择 ——
 * 见 guards.ts，那是唯一能拿到 store 的地方。
 */
export function legacyRoadmapTarget(langId: string): { baseline: string; target: string } | null {
  const baseline = defaultBaselineLanguageId
  const target = langId === baseline ? defaultCompareLanguageId : langId
  return getPair(baseline, target)?.sections.includes('roadmap') ? { baseline, target } : null
}

/**
 * 路由表。
 *
 * 约定：
 *  · history 模式（不是 hash）—— 这是预渲染与「URL 干净可分享」的前提（ADR-13）
 *  · **基准进 URL**：三套内容各自可预渲染、可分享（ADR-25）
 *  · **目标语言不进 URL**：它是"我现在想看哪个方向"，由每个板块页内的选择条决定。
 *    写进地址会让同一份内容散成 12 个地址，并让基础语法（列 = 基准 + 多选）
 *    与对级板块（一门目标 = 一篇文章）出现两套互不相容的 URL 语义
 *  · 参数化路由把 chapterId / featureId 里的 `/` 表达成路径分隔，无需 catch-all 参数
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
   * 两条参数化路由取代了原先的五条具名路由（每板块一条）。板块不再出现在路由名里，
   * 它是 `params.section` —— 由 SectionDispatchView 按注册表的 shape 选渲染器。
   * 加板块不需要在这里加任何东西。
   *
   * 4 段 = 章节型（`/compare/<基准>/<板块>/<章节 slug>`）；
   * 3 段 = 列表型 + 板块入口 + 旧的两段地址 —— 三者形状相同，靠守卫分流
   * （旧 topic id 里可能带着目标语言如 `js2python`，而路由的 redirect 函数
   * 够不到 store，只能交给守卫）。
   */
  {
    path: '/compare/:baseline/:section/:chapterSlug',
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

  /* ── 语言入口与特性详情（保留，归入对比流）── */
  {
    path: '/lang/:langId',
    name: 'language',
    component: () => import('@/views/LanguageView.vue'),
    props: true,
  },
  {
    path: '/feature/:topicId/:slug',
    name: 'feature',
    component: () => import('@/views/FeatureView.vue'),
    props: true,
  },

  /* ── 旧地址：确定性重定向到默认基准（旧语义就是「以 JS 为参照系」）──
   * 只用构建期常量，绝不读 localStorage —— 重定向在 SSG 与客户端两侧都会跑。 */
  {
    path: '/pitfalls',
    redirect: () => `/compare/${defaultBaselineLanguageId}/pitfalls`,
  },
  {
    path: '/glossary',
    redirect: () => `/compare/${defaultBaselineLanguageId}/glossary`,
  },
  {
    // 旧语义里带着目标语言，得先并进全局选择再跳 —— 交给守卫
    path: '/roadmap/:langId',
    name: 'legacy-roadmap',
    component: () => import('@/views/NotFoundView.vue'),
  },

  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'),
  },
  {
    path: '/attributions',
    name: 'attributions',
    component: () => import('@/views/AttributionsView.vue'),
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
