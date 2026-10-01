/**
 * 基准可切换 —— 「三门任选」这件事到底有没有真的生效。
 *
 * 这组断言守的是本次泛化最容易**静默**失效的三个性质：
 *   1. 列序**派生自** baseline，不是固定写死的「JS 永远第一列」
 *   2. 「已启用」≠「有资格当基准」—— 只有标了 baseline: true 的语言能被选中
 *   3. 行级 diff 的缓存 key 含基准与目标两侧，换基准必须重算，不能串味
 *
 * 之所以强调"静默"：这三处一旦坏掉，页面在默认 JS 基准下一切正常，
 * 只有用户切到 Python / Java 才走错分支，而构建、校验、类型检查全都不会报。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  baselineLanguageIds,
  defaultBaselineLanguageId,
  enabledLanguageIds,
} from '@/generated/registry.gen'
import { getCachedDiff } from '@/content/diff'
import { useLanguageStore } from '@/stores/language'

/** 已启用、但没资格当基准的语言（rust / go）—— 用来验证基准选择的收紧 */
const nonCandidate = enabledLanguageIds.find(
  (id) => !(baselineLanguageIds as readonly string[]).includes(id),
)

describe('基准语言泛化：候选集合与默认值', () => {
  it('候选恰好是 JS / Python / Java，默认基准是 JS', () => {
    expect([...baselineLanguageIds]).toEqual(['java', 'javascript', 'python'])
    expect(defaultBaselineLanguageId).toBe('javascript')
  })

  it('候选都必须是已启用语言，同时存在「已启用但非候选」的语言', () => {
    for (const id of baselineLanguageIds) {
      expect(enabledLanguageIds).toContain(id)
    }
    // 这个前提保证下面那条「拒绝非候选」的断言不是空转
    expect(nonCandidate).toBeTruthy()
  })
})

describe('基准语言泛化：列序派生自 baseline', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('无论基准是谁，基准列都排在最左', () => {
    const store = useLanguageStore()
    for (const id of baselineLanguageIds) {
      store.setBaseline(id)
      expect(store.orderedMeta[0]?.id).toBe(id)
      expect(store.orderedMeta).toHaveLength(store.activeMeta.length)
    }
  })

  it('切换基准不改变列数 —— 只重排，不增删', () => {
    const store = useLanguageStore()
    const before = store.orderedMeta.map((m) => m.id).sort()
    store.setBaseline('python')
    expect(store.orderedMeta.map((m) => m.id).sort()).toEqual(before)
  })

  it('已启用但未标 baseline 的语言不能当基准', () => {
    const store = useLanguageStore()
    const origin = store.baseline
    store.setBaseline(nonCandidate!)
    // 被拒绝：基准保持不变
    expect(store.baseline).toBe(origin)
  })

  it('基准选择器只列候选，语言列多选仍列全部已启用语言', () => {
    const store = useLanguageStore()
    expect(store.baselineCandidates.map((m) => m.id).sort()).toEqual(
      [...baselineLanguageIds].sort(),
    )
    // 两件事必须分开：候选 ≠ 可对比的语言
    expect(store.baselineCandidates.length).toBeLessThan(enabledLanguageIds.length)
  })
})

describe('基准语言泛化：diff 按基准重算', () => {
  it('缓存 key 含 (feature, 基准, 目标)——换基准不会读到上一个基准的结果', () => {
    const jsCode = 'const a = 1\nconsole.log(a)'
    const pyCode = 'a = 1\nprint(a)'

    const jsToPy = getCachedDiff('f1|javascript|python', jsCode, pyCode)
    const pyToJs = getCachedDiff('f1|python|javascript', pyCode, jsCode)

    // 反向对照必须是一次独立计算，不能命中正向的缓存
    expect(pyToJs).not.toBe(jsToPy)
    // 同一组 (基准, 目标) 反复取才复用同一对象
    expect(getCachedDiff('f1|javascript|python', jsCode, pyCode)).toBe(jsToPy)
  })

  it('两个方向的差异结果确实不同 —— 基准可切意味着 diff 可切', () => {
    const jsCode = 'const a = 1\nconsole.log(a)'
    const pyCode = 'a = 1\nprint(a)'

    const jsToPy = getCachedDiff('f2|javascript|python', jsCode, pyCode)
    const pyToJs = getCachedDiff('f2|python|javascript', pyCode, jsCode)

    // 两边都是「两行全改」，但比对的是不同的字符串对
    expect(jsToPy.total).toBe(pyCode.split('\n').length)
    expect(pyToJs.total).toBe(jsCode.split('\n').length)
    expect(jsToPy.changed.size).toBe(2)
    expect(pyToJs.changed.size).toBe(2)
  })
})
