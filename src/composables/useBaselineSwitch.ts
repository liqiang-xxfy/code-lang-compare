/**
 * 切换基准语言 = **导航**，不是改本地状态。
 *
 * 为什么：每个基准有自己的一套内容与地址（`/compare/<基准>/...`），
 * 「以 Python 为基准看基础语法」与「以 JavaScript 为基准看基础语法」是两页不同内容。
 *
 * 回落规则（骨架期必然会用到 —— Python / Java 基准目前只有 1 章、只有部分方向）：
 *   同一章 → 该基准下这一板块的第一个可用项 → 该基准的基础语法首章 → /404
 */
import { useRoute, useRouter } from 'vue-router'
import {
  orderedSections,
  pairTargetsOf,
  sectionIsChapter,
  sectionPathOf,
  visibleChaptersOf,
} from '@/content/repository'
import { sectionEntryPath, sectionOfRoute } from '@/router'
import { useLanguageStore } from '@/stores/language'
import type { Section } from '@/schemas'

export interface SwitchContext {
  section: Section | null
  /** 章节 slug（章节型板块才有）；列表型板块没有章节概念 */
  key: string | null
}

/** 没有板块时的落点：第一个真正有内容的章节型板块的首章（即基础语法） */
function firstChapterSectionEntry(baseline: string): string {
  for (const def of orderedSections()) {
    if (def.shape !== 'chapter') continue
    const path = sectionEntryPath(baseline, def.id)
    if (path !== '/404') return path
  }
  return '/404'
}

/**
 * 纯函数，便于测试：给定目标基准与当前上下文，算出该落到哪个地址。
 *
 * 分支按板块的 `shape` 分（章节型 / 列表型），不再逐个列举板块名 ——
 * 曾经是 `basics` / `migration` / 三个列表各一条 if，加板块必然漏。
 */
export function resolveSwitchPath(baseline: string, ctx: SwitchContext): string {
  const { section, key } = ctx

  if (section && sectionIsChapter(section)) {
    /*
     * 同一章能保留就保留 —— 用户换的是参照系，不是想换一章。
     *
     * 两个判据都要过，缺一个就会落到空白页：
     *   1. **章节本身存在于新基准的分类里** —— 每个基准一套章节分类（ADR-52），
     *      同名不代表同义，新基准可能根本没有这一章
     *   2. 新基准确实写了这一章引用的某个存放组（骨架期很多章还没内容）
     * 两者合起来就是 `visibleChaptersOf` —— 全站唯一的章节可见性判据。
     */
    if (key && visibleChaptersOf(baseline, section).some((c) => c.id === key)) {
      return `/compare/${baseline}/${section}/${key}`
    }
    return sectionEntryPath(baseline, section)
  }

  if (section) {
    // 目标语言不进 URL，所以这里只需确认该基准下这个板块确实有内容
    return pairTargetsOf(baseline, section).length ? sectionPathOf(baseline, section) : '/404'
  }

  return firstChapterSectionEntry(baseline)
}

export function useBaselineSwitch() {
  const router = useRouter()
  const route = useRoute()
  const languages = useLanguageStore()

  return function switchBaseline(baseline: string): void {
    if (!languages.baselineCandidates.some((m) => m.id === baseline)) return
    const ctx: SwitchContext = {
      section: sectionOfRoute(route),
      key: typeof route.params.chapter === 'string' ? route.params.chapter : null,
    }
    languages.rememberBaseline(baseline)
    void router.push(resolveSwitchPath(baseline, ctx))
  }
}
