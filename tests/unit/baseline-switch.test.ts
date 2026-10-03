/**
 * 全局语言选择（基准 + 对比语言）的行为契约。
 *
 * 这组断言守的是最容易**静默**失效的几个性质：
 *   1. 基准以**路由参数**为准，localStorage 只是无基准路由的兜底
 *   2. 「已启用」≠「有资格当基准」—— 只有标了 baseline: true 的语言能被选中
 *   3. 章节型板块多列（基准 + 勾选，**可以一门都不勾 = 只看基准**）；
 *      对级板块锁定成 [基准, 目标]
 *   4. **目标语言不在 URL 里**，所以「现在该看哪个方向」必须可推导且可预测
 *   5. 切基准时的回落（骨架期 Python / Java 只有 1 章、只有部分方向）
 *
 * 之所以强调"静默"：这几处一旦坏掉，默认 JS 基准下页面一切正常，
 * 只有用户切到别的基准或换方向才走错分支，而构建、校验、类型检查全都不会报。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  baselineLanguageIds,
  defaultBaselineLanguageId,
  defaultCompareLanguageId,
  enabledLanguageIds,
} from '@/generated/registry.gen'
import { chaptersOf, hasChapterContent, manifest, pairTargetsOf, resolvePairTarget } from '@/content/repository'
import { resolveSwitchPath } from '@/composables/useBaselineSwitch'
import { pickColumns } from '@/composables/useVisibleColumns'
import { sectionEntryPath } from '@/router'
import { useLanguageStore } from '@/stores/language'

/** 已启用、但没资格当基准的语言（rust / go）—— 用来验证基准选择的收紧 */
const nonCandidate = enabledLanguageIds.find(
  (id) => !(baselineLanguageIds as readonly string[]).includes(id),
)

/**
 * 某个基准在某个板块下「章节分类里有、但还没写内容」的章。
 *
 * 骨架期**必然存在**（清单一次列全、正文按批填），但会随内容爬坡逐个消失，
 * 所以回落的用例按它推导例子，而不是写死某章的 id —— 否则每填一批内容
 * 就要改一次测试，而那属于「测试钉住了爬坡进度」而不是「钉住了契约」。
 * 内容铺满后这两条用例自动不再断言（前提已不成立），不需要删。
 */
const emptyChapterOf = (baseline: string, section: 'express' | 'model'): string | null =>
  chaptersOf(baseline, section).find((c) => !hasChapterContent(baseline, baseline, section, c.id))
    ?.id ?? null

/**
 * 每个用例都从一块干净的 localStorage 开始。
 *
 * 语言选择是**持久化**的（这是它的产品语义：下次来还是你上次选的那些），
 * 但测试之间共享它会让前一个用例的选择渗进后一个 —— 那正是本组最容易
 * 出现"改了 A 却红了 B"的地方。
 */
beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear()
  setActivePinia(createPinia())
})

describe('全局选择：候选集合与默认值', () => {
  it('候选恰好是 JS / Python / Java，默认基准是 JS', () => {
    // 顺序 = registry.yaml 里 languages 段的声明序（ADR-58），不是字母序
    expect([...baselineLanguageIds]).toEqual(['javascript', 'python', 'java'])
    expect(defaultBaselineLanguageId).toBe('javascript')
  })

  it('默认对比语言已启用，且不等于默认基准', () => {
    expect(defaultCompareLanguageId).toBe('python')
    expect(enabledLanguageIds).toContain(defaultCompareLanguageId)
    expect(defaultCompareLanguageId).not.toBe(defaultBaselineLanguageId)
  })

  it('候选都必须是已启用语言，同时存在「已启用但非候选」的语言', () => {
    for (const id of baselineLanguageIds) {
      expect(enabledLanguageIds).toContain(id)
    }
    expect(nonCandidate).toBeTruthy()
  })
})

describe('全局选择：列的计算', () => {
  it('基础语法：基准永远在最左，对比列不含基准自身', () => {
    const store = useLanguageStore()
    for (const id of baselineLanguageIds) {
      store.setRouteContext(id, 'basics')
      expect(store.orderedMeta[0]?.id).toBe(id)
      // 基准恰好就是唯一勾选的那门时（python 基准 × 默认对比语言），
      // 对比列就是空的 —— 只剩基准一列，不补位
      expect(store.compareMeta.map((m) => m.id)).not.toContain(id)
    }
  })

  it('默认基准下的对比列就是默认对比语言', () => {
    const store = useLanguageStore()
    store.setRouteContext(defaultBaselineLanguageId, 'basics')
    expect(store.compareMeta.map((m) => m.id)).toEqual([defaultCompareLanguageId])
  })

  it('基础语法：勾选多门就多列，且不含基准自身', () => {
    const store = useLanguageStore()
    store.setRouteContext('javascript', 'basics')
    store.toggleCompare('go')
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['javascript', 'python', 'go'])
    expect(store.compareMeta.map((m) => m.id)).not.toContain('javascript')
  })

  it('路由基准优先于 localStorage 里的「上次选择」', () => {
    const store = useLanguageStore()
    store.rememberBaseline('java')
    store.setRouteContext('python', 'basics')
    expect(store.effectiveBaseline).toBe('python')

    // 离开对比页后回落到「上次选择」
    store.setRouteContext(null, null)
    expect(store.effectiveBaseline).toBe('java')
  })

  it('已启用但未标 baseline 的语言不能成为基准', () => {
    const store = useLanguageStore()
    store.rememberBaseline(defaultBaselineLanguageId)
    store.rememberBaseline(nonCandidate!)
    expect(store.effectiveBaseline).toBe(defaultBaselineLanguageId)
  })

  it('对级板块：列恒为 [基准, 目标] 两列，换方向也不变成多列', () => {
    const store = useLanguageStore()
    store.setRouteContext('javascript', 'pitfalls')
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['javascript', store.pairTarget])
    expect(store.isPairMode).toBe(true)

    // 页内选择条换一门方向：列**换成**它（一门目标 = 一篇文章），而不是并排铺开
    store.setPairTarget('rust')
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['javascript', 'rust'])
  })

  it('基础语法下没有「目标语言」这个概念', () => {
    const store = useLanguageStore()
    store.setRouteContext('javascript', 'basics')
    expect(store.pairTarget).toBeNull()
    expect(store.isPairMode).toBe(false)
  })

  it('一门对比语言都没勾时只留基准列 —— 不补一门用户没勾的', () => {
    const store = useLanguageStore()
    store.setRouteContext('javascript', 'basics')
    store.toggleCompare(defaultCompareLanguageId) // 取消默认勾选的那门
    expect(store.compareLangs).toEqual([])
    expect(store.compareMeta).toEqual([])
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['javascript'])
  })

  it('基准换成被勾选的那门时，那一门从对比列里退出 —— 不补位', () => {
    const store = useLanguageStore()
    store.reset() // 勾选集合 = [默认对比语言]
    store.setRouteContext('python', 'basics')
    // 默认对比语言恰好就是 python 基准本身：它此刻的身份是基准列，不是对比列。
    // 曾经这里会补一门非基准语言进去，于是页面上并列着一列没勾上的语言 ——
    // 用户点它想「取消」，走的却是 toggleCompare 的新增分支。
    expect(store.compareLangs).toEqual([defaultCompareLanguageId])
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['python'])
  })

  it('本章有实现的勾选语言按列序跟上，基准列恒在最左', () => {
    const store = useLanguageStore()
    store.setRouteContext('java', 'basics')
    store.toggleCompare('go')
    // 枚举顺序是 javascript / python / java / go / rust（registry 声明序），列序照它走
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['java', 'python', 'go'])
    // 基准列即便本章没有实现也保留；其余按「真有实现」过筛
    expect(pickColumns(store.orderedMeta, 'java', new Set(['python', 'go'])).map((m) => m.id)).toEqual(
      ['java', 'python', 'go'],
    )
  })

  it('勾选的语言在本章一格都没写时只留基准列 —— 不补一门用户没勾、也去不掉的列', () => {
    const store = useLanguageStore()
    store.setRouteContext('java', 'inside')
    expect(store.compareLangs).toEqual([defaultCompareLanguageId])

    // present = 本章真有分片的语言。这里模拟「只有基准列有」的情形
    const columns = pickColumns(store.orderedMeta, 'java', new Set(['java']))
    expect(columns.map((m) => m.id)).toEqual(['java'])
    // 这里曾补上一门有实现的语言 —— 它不在勾选集合里，而选择条的勾选态读的正是
    // compareLangs，于是页面并列着一列没勾上的语言，用户点它想「取消」，
    // 走的却是 toggleCompare 的新增分支。
    expect(store.compareLangs).not.toContain('javascript')
  })
})

/**
 * 「我熟悉 Python」那个入口的真实场景：默认对比语言就是 Python，
 * 而读者点进去的基准也是 Python —— 唯一的勾选被基准吃掉，页面只剩一列。
 *
 * 修的是**勾选集合本身**（进得去、点得掉），不是在渲染层补一列：
 * 补出来的列不在 compareLangs 里，会被画成「已勾」却点不掉（ADR-34）。
 */
describe('全局选择：进入基准时，救回被基准吃掉的那一勾', () => {
  it('唯一勾选就是新基准时，换成默认对比语言', () => {
    const store = useLanguageStore()
    store.reset() // 勾选集合 = [默认对比语言]，而它就是下面这个基准
    store.ensureCompareFor(defaultCompareLanguageId)
    expect(store.compareLangs).toEqual([defaultBaselineLanguageId])

    // 页面因此拿到两列，而不是退化成「只有基准」
    store.setRouteContext(defaultCompareLanguageId, 'basics')
    expect(store.orderedMeta.map((m) => m.id)).toEqual([
      defaultCompareLanguageId,
      defaultBaselineLanguageId,
    ])
  })

  it('空集合不补位 —— 那是读者表达过的「只看基准」（ADR-63）', () => {
    const store = useLanguageStore()
    store.toggleCompare(defaultCompareLanguageId) // 取消最后一项 → []
    store.ensureCompareFor(defaultCompareLanguageId)
    expect(store.compareLangs).toEqual([])
  })

  it('还有别的勾选能当对比列时，不动读者的选择', () => {
    const store = useLanguageStore()
    store.toggleCompare('go')
    const before = [...store.compareLangs]
    store.ensureCompareFor(defaultCompareLanguageId)
    expect(store.compareLangs).toEqual(before)
  })

  it('换回默认基准时同样成立（两门基准互为默认对比语言）', () => {
    const store = useLanguageStore()
    store.reset()
    store.ensureCompareFor(defaultCompareLanguageId)
    store.ensureCompareFor(defaultBaselineLanguageId)
    expect(store.compareLangs).toEqual([defaultCompareLanguageId])
  })
})

describe('全局选择：目标语言如何推导（它不在 URL 里）', () => {
  it('优先取用户最近挑的那门', () => {
    expect(resolvePairTarget('javascript', 'pitfalls', ['python', 'go'], 'go')).toBe('go')
  })

  it('最近挑的那门在该板块没有内容时，回落到已勾选里第一个有内容的', () => {
    // 在 python 基准下挑 python —— 它是当前基准，永远不可能出现在自己的方向里
    const available = pairTargetsOf('python', 'pitfalls')
    const other = available.find((t) => t !== available[0])!
    expect(resolvePairTarget('python', 'pitfalls', [other], 'python')).toBe(other)
  })

  it('勾选的都没内容时，回落到该板块第一个可用方向（按书写序，不是字典序）', () => {
    // 首访时勾选里是默认对比语言 python，而当前基准就是 python ——
    // 这正是「勾选里没有任何可用目标」那条分支的真实触发场景（不是造出来的用例）。
    // 「第一个」由语言书写序决定（ADR-67）：字典序会先排到 go，书写序先排到 javascript。
    const available = pairTargetsOf('python', 'pitfalls')
    expect(available[0]).toBe('javascript')
    expect(resolvePairTarget('python', 'pitfalls', ['python'], null)).toBe(available[0])
  })

  it('该板块一个方向都没有时返回 null（调用方据此 404）', () => {
    // typescript 尚未启用，任何方向都不涉及它
    expect(resolvePairTarget('typescript', 'pitfalls', ['python'], null)).toBeNull()
  })

  it('preferTarget 会把目标并进勾选集合，而不是替换掉它', () => {
    const store = useLanguageStore()
    store.setRouteContext('javascript', 'pitfalls')
    store.preferTarget('go')
    expect(store.pairTarget).toBe('go')
    // python 仍在列里（它只是不再是当前方向），没被悄悄取消
    expect(store.compareMeta.map((m) => m.id)).toContain(defaultCompareLanguageId)
  })

  it('页内选择条选方向：setPairTarget 只改方向，不动基础语法的对比列', () => {
    const store = useLanguageStore()
    store.reset()
    store.setRouteContext('javascript', 'pitfalls')
    const before = [...store.compareLangs]
    store.setPairTarget('go')
    expect(store.pairTarget).toBe('go')
    // 这是 setPairTarget 与 preferTarget 的唯一区别：方向选择条不该顺手
    // 改动用户在基础语法里挑的那几列（preferTarget 会把目标并进去）
    expect(store.compareLangs).toEqual(before)
  })

  it('在基础语法里勾一门语言时，它也顺带成为对级板块的当前方向', () => {
    const store = useLanguageStore()
    store.reset()
    store.setRouteContext('javascript', 'pitfalls')
    store.toggleCompare('go')
    expect(store.pairTarget).toBe('go')
  })
})

describe('全局选择：切换基准时的回落', () => {
  it('同一章能保留就保留 —— 前提是**新基准的章节分类里也有这一章且有内容**', () => {
    expect(resolveSwitchPath('javascript', { section: 'express', key: 'bindings' })).toBe(
      '/compare/javascript/express/bindings',
    )
    // python 那边对应的一章叫 names 而不是 bindings —— 同名章节不代表同义（ADR-52）
    expect(resolveSwitchPath('python', { section: 'express', key: 'names' })).toBe(
      '/compare/python/express/names',
    )
    // 分类里有、但这一门还没写内容的章同样要回落（骨架期的常态）
    const emptyPy = emptyChapterOf('python', 'express')
    if (emptyPy) {
      expect(resolveSwitchPath('python', { section: 'express', key: emptyPy })).toBe(
        sectionEntryPath('python', 'express'),
      )
    }
  })

  it('新基准没有这一章（或还没写内容）时，落到它自己第一个有内容的章节', () => {
    // 分类里不存在的章 → 回落
    expect(resolveSwitchPath('javascript', { section: 'express', key: '99-nonexistent' })).toBe(
      sectionEntryPath('javascript', 'express'),
    )
    // 'bindings' 只存在于 JS 的分类里 → python 基准下要回落
    expect(resolveSwitchPath('python', { section: 'express', key: 'bindings' })).toBe(
      sectionEntryPath('python', 'express'),
    )
    // 同一条在 java 基准下同样不存在（java 把这几条归进了「类型、声明与命名」）→ 回落
    expect(resolveSwitchPath('java', { section: 'express', key: 'bindings' })).toBe(
      sectionEntryPath('java', 'express'),
    )
  })

  it('基准连一个存放组都没写时，整块没有落点（骨架期的板块就是这种状态）', () => {
    // 找一个「章节分组在、内容一个都没写」的基准 × 板块 —— 骨架期必然有，
    // 铺满后自动不再断言（那时这条前提已经不存在了）
    const barren = baselineLanguageIds.flatMap((b) =>
      (['express', 'model'] as const)
        .filter((s) => chaptersOf(b, s).length > 0 && sectionEntryPath(b, s) === '/404')
        .map((s) => ({ baseline: b, section: s })),
    )[0]
    if (barren) {
      expect(resolveSwitchPath(barren.baseline, { section: barren.section, key: null })).toBe('/404')
    }
  })

  it('列表板块：地址里没有目标，只要该基准下有内容就跳过去', () => {
    expect(resolveSwitchPath('javascript', { section: 'pitfalls', key: null })).toBe(
      '/compare/javascript/pitfalls',
    )
    // python 基准下只有一个方向有陷阱内容
    expect(resolveSwitchPath('python', { section: 'pitfalls', key: null })).toBe(
      '/compare/python/pitfalls',
    )
  })

  it('非对比页（section 为 null）落到该基准第一个有内容的章节型板块', () => {
    expect(resolveSwitchPath('javascript', { section: null, key: null })).toBe(
      sectionEntryPath('javascript', 'express'),
    )
  })

  it('有内容的基准候选有落点；还没写内容的落到 /404 而不是空白页', () => {
    for (const id of baselineLanguageIds) {
      const path = resolveSwitchPath(id, { section: null, key: null })
      const sections = ['express', 'model', 'mechanism', 'practice'] as const
      const hasContent = sections.some((s) => sectionEntryPath(id, s) !== '/404')
      expect(path === '/404', `${id} 的落点与内容存量的判断不一致`).toBe(!hasContent)
    }
  })
})

describe('全局选择：manifest 是客户端唯一的「有哪些方向」来源', () => {
  it('每个 pair 都属于一个已启用的基准候选，且目标 ≠ 基准', () => {
    expect(manifest.pairs.length).toBeGreaterThan(0)
    for (const p of manifest.pairs) {
      expect(baselineLanguageIds).toContain(p.baseline)
      expect(p.target).not.toBe(p.baseline)
      expect(p.sections.length).toBeGreaterThan(0)
    }
  })

  it('章节型板块是基准级的：它是参照系下的对照，不锁定任何单一方向', () => {
    const chapterSections = manifest.sections.filter((s) => s.shape === 'chapter')
    expect(chapterSections.length).toBeGreaterThan(0)
    for (const s of chapterSections) {
      // 基准级板块没有方向概念 —— 有 direction 就说明配错了 scope
      expect(s.scope).toBe('baseline')
      expect(manifest.pairs.some((p) => p.sections.includes(s.id))).toBe(false)
    }
  })

  /*
   * ADR-67：方向的顺序**按语言书写序**，不是目录名字典序。
   *
   * 这个顺序不止是显示顺序 —— `resolvePairTarget` 在「勾选里没有该基准可用的目标」
   * 时回落到 `available[0]`，于是它同时决定了「以 Python 为基准的读者打开速查默认看到
   * 哪个方向」。字典序下补齐 12 个方向后 python 基准会落到 go，书写序下落回 javascript。
   * 构建期的 SEO 选向（`pickPairTarget`）与预渲染探针都跟着这一条走。
   */
  it('ADR-67：可用目标按语言书写序排列（回落取的就是第一个）', () => {
    const rank = (id: string): number => enabledLanguageIds.indexOf(id as never)
    for (const section of manifest.sections.filter((s) => s.scope === 'pair').map((s) => s.id)) {
      for (const baseline of baselineLanguageIds) {
        const available = pairTargetsOf(baseline, section)
        const ranks = available.map(rank)
        expect(ranks, `${baseline}/${section} 的目标不是书写序`).toEqual(
          [...ranks].sort((x, y) => x - y),
        )
        if (available.length) {
          // 一门都没勾时回落 available[0] —— 它必须是书写序第一个，不是字典序第一个
          expect(resolvePairTarget(baseline, section, [], null)).toBe(available[0])
        }
      }
    }
  })
})
