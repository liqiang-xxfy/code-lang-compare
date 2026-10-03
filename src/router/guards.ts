import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import {
  chapterOf,
  featureMetaOf,
  hasBoxChapter,
  hasPairSection,
  sectionDefOf,
  sectionIsChapter,
} from '@/content/repository'
import { enabledLanguageIds } from '@/generated/registry.gen'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import type { Section } from '@/schemas'
import { isEnabledLanguage, isSection, sectionEntryPath } from './index'

/**
 * 一个章节页实际会渲染的语言列。
 *
 * 为什么在守卫里自己算、不复用 store 的 `orderedMeta`：**守卫跑在 App 的路由
 * watcher 之前**，那时 `routeBaseline` 还是 null，`effectiveBaseline` 会落到
 * localStorage 的「上次选择」上 —— 用错了基准就会去加载另一套分片
 * （这正是 repository 里那段注释警告过的坑）。
 *
 * 勾选集合（`compareLangs`）是本地持久化状态，不依赖路由，可以放心读。
 */
function visibleLangs(
  languages: ReturnType<typeof useLanguageStore>,
  baseline: string,
  section: Section,
  chapter: string,
): string[] {
  const picked = languages.compareLangs.filter((id) => id !== baseline)
  // 与 store 的 compareMeta 同口径：一门都没勾时回落到第一门非基准语言
  const fallback = enabledLanguageIds.find((id) => id !== baseline)
  const others = picked.length ? picked : fallback ? [fallback] : []
  return [baseline, ...others].filter((id) => hasBoxChapter(id, section, chapter))
}

/**
 * 路由守卫 —— 在这里把「分片内容」加载完，视图组件就能同步渲染。
 *
 * 为什么不用组件内 await / <Suspense>：
 *  预渲染（SSG）与客户端 CSR 必须走**同一条取数路径**，否则会出现「预渲染出来的 HTML
 *  和客户端渲染的结果不一致」。守卫里 await 之后，两条路径都变成同步渲染（§7.1）。
 *
 * v2 的两条约束：
 *  · **目标语言要在守卫里解析**（列表型板块）。它不在路由参数里，而视图依赖它，
 *    所以算完（并据此加载对级分片）之后，视图拿到的才是自洽的一页。
 *  · **基准列必须真有分片**。清单是语言无关的，但某个基准可能还没写这一章 ——
 *    落到那里会是一页没有参照系的空白，不如 404。
 */
export function installGuards(router: Router, pinia: Pinia): void {
  router.beforeEach(async (to) => {
    const content = useContentStore(pinia)
    const languages = useLanguageStore(pinia)

    /*
     * 3 段地址：章节型板块的**入口** redirect，或列表型板块自己的落点。
     */
    if (to.name === 'compare-section') {
      const baseline = String(to.params.baseline ?? '')
      const section = String(to.params.section ?? '')
      if (!isEnabledLanguage(baseline) || !isSection(section)) return { name: 'not-found' }
      const def = sectionDefOf(section)
      if (!def) return { name: 'not-found' }

      if (def.shape === 'chapter') {
        const entry = sectionEntryPath(baseline, section)
        return entry === '/404' ? { name: 'not-found' } : entry
      }

      // 必须用路由里的基准，不能用 store 的「上次选择」—— 守卫跑在路由 watcher 之前
      const target = languages.resolveTargetFor(section, baseline)
      // 与 routes / sitemap 同源：manifest.pairs 里没有的组合一律 404，杜绝空白页
      if (!target || !hasPairSection(baseline, target, section)) return { name: 'not-found' }
      if (!(await content.ensurePair(baseline, target))) return { name: 'not-found' }
      /*
       * 这里**必须 return true**，不能 `return sectionEntryPath(...)` ——
       * 列表型板块的「入口地址」正是当前地址，返回它等于自我重定向，
       * vue-router 会判定无限重定向并 abort 导航（页面直接黑掉）。
       */
      return true
    }

    /*
     * 4 段地址：章节页 `/compare/<基准>/<板块>/<章节>`。
     * 章节 id 即文件名，**没有序号**（顺序的唯一真源是清单的数组顺序）。
     */
    if (to.name === 'compare-chapter') {
      const baseline = String(to.params.baseline ?? '')
      const section = String(to.params.section ?? '')
      const chapter = String(to.params.chapter ?? '')
      if (!isEnabledLanguage(baseline) || !isSection(section)) return { name: 'not-found' }
      // 4 段地址只对章节型板块有意义 —— `/compare/<基准>/<速查板块>/xxx` 一律 404
      if (!sectionIsChapter(section)) return { name: 'not-found' }
      if (!chapterOf(section, chapter)) return { name: 'not-found' }
      /*
       * 基准列必须有内容 —— 它是这一页的参照系。没有分片就说明这个基准还没写这一章
       * （清单是语言无关的，三个基准共用同一套章节），渲染出来是一页没有参照系的空白。
       */
      if (!hasBoxChapter(baseline, section, chapter)) return { name: 'not-found' }
      /*
       * **所有可见列**都要在这里 await 完，不能只加载基准列 ——
       * 视图那个 watcher 是异步的，而 SSG 在守卫 resolve 之后**同步**渲染，
       * 只等基准列的话，预渲染出来的页面里其余列全是「加载中」。
       * 这正是「预渲染出空壳」的一类：页面结构在、内容不在。
       */
      await content.ensureColumns(
        section,
        chapter,
        visibleLangs(languages, baseline, section, chapter),
      )
      return true
    }

    /*
     * 特性详情：`/feature/<板块>/<章节>/<feature>`（全局 id 三段）。
     * 同样的道理：所有可见列都要在这里 await 完。
     */
    if (to.name === 'feature') {
      const section = String(to.params.section ?? '')
      const chapter = String(to.params.chapter ?? '')
      const gid = `${section}/${chapter}/${String(to.params.feature ?? '')}`
      const meta = featureMetaOf(gid)
      if (!meta || !isSection(meta.section)) return { name: 'not-found' }
      const baseline = languages.effectiveBaseline
      if (hasBoxChapter(baseline, meta.section, meta.chapter)) {
        await content.ensureColumns(
          meta.section,
          meta.chapter,
          visibleLangs(languages, baseline, meta.section, meta.chapter),
        )
      }
      return true
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
