import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import {
  chapterPathOf,
  hasPairSection,
  manifest,
  sectionDefOf,
  sectionIsChapter,
  topicIdOf,
} from '@/content/repository'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import {
  isEnabledLanguage,
  isSection,
  legacyRoadmapTarget,
  legacyTopicPath,
  legacyTopicTarget,
  sectionEntryPath,
} from './index'

/**
 * 路由守卫 —— 在这里把「分片内容」加载完，视图组件就能同步渲染。
 *
 * 为什么不用组件内 await / <Suspense>：
 *  预渲染（SSG）与客户端 CSR 必须走**同一条取数路径**，否则会出现「预渲染出来的 HTML
 *  和客户端渲染的结果不一致」。守卫里 await 之后，两条路径都变成同步渲染（§7.1）。
 *
 * 补充一条 P8 的约束：**目标语言要在这里解析**。它不在路由参数里，而视图依赖它，
 * 所以在守卫里算完（并据此加载对级分片）之后，视图拿到的才是自洽的一页。
 */
export function installGuards(router: Router, pinia: Pinia): void {
  router.beforeEach(async (to) => {
    const content = useContentStore(pinia)
    const languages = useLanguageStore(pinia)

    /*
     * 两段地址（`/compare/<A>/<B>`）同时承载两种历史形态：
     *   · 板块入口      A = 语言,   B = 板块名
     *   · P7 之前的旧地址 A = topicId, B = 章节 slug
     * 用一条路由 + 守卫分流，是因为旧 topic id 里可能带着目标语言（`js2python`），
     * 而路由的 redirect 函数够不到 store。
     */
    /*
     * 3 段地址：列表型板块的落点、章节型板块的**入口**、以及 P7 之前的两段旧地址。
     * 三者形状相同，只能靠守卫分流。
     */
    if (to.name === 'compare-section') {
      const a = String(to.params.baseline ?? '')
      const b = String(to.params.section ?? '')

      /* 已注册板块的 3 段地址：章节型是「板块入口」，列表型就是它自己的落点 */
      if (isEnabledLanguage(a) && isSection(b)) {
        const def = sectionDefOf(b)
        if (!def) return { name: 'not-found' }

        if (def.shape === 'chapter') {
          const entry = sectionEntryPath(a, b)
          return entry === '/404' ? { name: 'not-found' } : entry
        }

        const target = languages.resolveTargetFor(b, a)
        // 与 routes / sitemap 同源：manifest.pairs 里没有的组合一律 404，杜绝空白页
        if (!target || !hasPairSection(a, target, b)) return { name: 'not-found' }
        if (!(await content.ensurePair(a, target))) return { name: 'not-found' }
        /*
         * 这里**必须 return true**，不能 `return sectionEntryPath(a, b)` ——
         * 列表型板块的「入口地址」正是当前地址，返回它等于自我重定向，
         * vue-router 会判定无限重定向并 abort 导航（页面直接黑掉）。
         */
        return true
      }

      /* 认不出板块名 → 当作旧的两段地址：A = topicId, B = 章节 slug */
      const target = legacyTopicTarget(a)
      if (target) languages.preferTarget(target)
      const path = legacyTopicPath(a, b)
      return path === '/404' ? { name: 'not-found' } : path
    }

    if (to.name === 'compare-chapter') {
      const baseline = String(to.params.baseline ?? '')
      const section = String(to.params.section ?? '')
      if (!isEnabledLanguage(baseline) || !isSection(section)) return { name: 'not-found' }
      // 4 段地址只对章节型板块有意义 —— `/compare/js/pitfalls/xxx` 一律 404
      if (!sectionIsChapter(section)) return { name: 'not-found' }
      // 必须用路由里的基准，不能用 store 的上次选择（守卫跑在路由 watcher 之前）
      const target = languages.resolveTargetFor(section, baseline) ?? undefined
      /*
       * 路由参数里没有 topicId —— 它由 (基准, 板块, 目标) 从 manifest 反查。
       * 拼不出来（该基准下没有这个方向）就是 404，而不是渲染一个空页面。
       */
      const topicId = topicIdOf(baseline, section, target)
      if (!topicId) return { name: 'not-found' }

      const slug = String(to.params.chapterSlug ?? '')
      const topic = manifest.topics.find((t) => t.id === topicId)
      /*
       * 切目标语言时，原来那一章可能在新方向下不存在（骨架期的方向章数不同）。
       * 这里回落到该方向的首章，而不是 404 —— 用户改的是"看哪个方向"，
       * 不是"看哪一章"，为这个差别丢一个 404 说不过去。
       */
      if (!topic?.chapters.some((c) => c.id.split('/')[1] === slug)) {
        const first = topic?.chapters[0]
        if (!first) return { name: 'not-found' }
        // 由 topic 的三轴字段派生地址，不要拼 `migration` 字面量 ——
        // 这个分支 basics 与 migration 共用，写死板块名会把基础语法的坏 slug 送到迁移教程。
        return chapterPathOf(first.id)
      }

      const chapter = await content.ensureChapter(`${topicId}/${slug}`)
      if (!chapter) return { name: 'not-found' }
      return true
    }

    if (to.name === 'feature') {
      const topicId = String(to.params.topicId ?? '')
      const featureId = `${topicId}/${String(to.params.slug ?? '')}`
      const feature = await content.ensureFeature(featureId)
      if (!feature) return { name: 'not-found' }
      /*
       * 顺带把「相关迁移陷阱」那一份对级分片也加载好 —— 特性页会同步读它。
       * 未加载时视图拿到的是空列表（不报错），但那就等于静默少了内容。
       */
      const cfg = manifest.topics.find((t) => t.id === topicId)
      if (cfg?.target) await content.ensurePair(cfg.baseline, cfg.target)
      return true
    }

    if (to.name === 'legacy-roadmap') {
      const hit = legacyRoadmapTarget(String(to.params.langId ?? ''))
      if (!hit) return { name: 'not-found' }
      languages.preferTarget(hit.target)
      return `/compare/${hit.baseline}/roadmap`
    }

    if (to.name === 'language') {
      const langId = String(to.params.langId ?? '')
      const { getLanguageMeta } = await import('@/generated/registry.gen')
      if (!getLanguageMeta(langId)) return { name: 'not-found' }
      return true
    }

    return true
  })
}
