/**
 * 全局语言选择（基准 + 对比语言）的行为契约。
 *
 * 这组断言守的是最容易**静默**失效的几个性质：
 *   1. 基准以**路由参数**为准，localStorage 只是无基准路由的兜底
 *   2. 「已启用」≠「有资格当基准」—— 只有标了 baseline: true 的语言能被选中
 *   3. 基础语法多列（基准 + 勾选）；对级板块锁定成 [基准, 目标]
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
import { getCachedDiff } from '@/content/diff'
import { manifest, resolvePairTarget } from '@/content/repository'
import { resolveSwitchPath } from '@/composables/useBaselineSwitch'
import { sectionEntryPath } from '@/router'
import { useLanguageStore } from '@/stores/language'

/** 已启用、但没资格当基准的语言（rust / go）—— 用来验证基准选择的收紧 */
const nonCandidate = enabledLanguageIds.find(
  (id) => !(baselineLanguageIds as readonly string[]).includes(id),
)

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
    expect([...baselineLanguageIds]).toEqual(['java', 'javascript', 'python'])
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
      // 基准恰好就是默认对比语言时（python 基准），对比列会回落到另一门 ——
      // 但任何情况下都不允许出现"基准与对比列是同一门"这种恒等的空列
      expect(store.compareMeta.length).toBeGreaterThan(0)
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
    expect(store.orderedMeta.map((m) => m.id)).toEqual(['javascript', 'go', 'python'])
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

  it('基准换成被勾选的那门时补齐一列 —— 不会出现「看着是勾上的、其实没勾」', () => {
    const store = useLanguageStore()
    store.reset() // 勾选集合 = [默认对比语言]
    store.setRouteContext('python', 'basics')
    // 默认对比语言恰好就是 python 基准本身：归一化必须补一门非基准语言进去，
    // 否则 compareMeta 的回落分支会给出一门不在 compareLangs 里的语言 ——
    // 界面把它显示成已勾选，用户去取消它，toggleCompare 反而把它加进去。
    const checked = store.compareLangs.filter((id) => id !== 'python')
    expect(checked.length).toBeGreaterThan(0)
    // 「勾选集合」与「渲染列」恒等
    expect(store.compareMeta.map((m) => m.id)).toEqual(checked)
  })
})

describe('全局选择：目标语言如何推导（它不在 URL 里）', () => {
  it('优先取用户最近挑的那门', () => {
    expect(resolvePairTarget('javascript', 'pitfalls', ['python', 'go'], 'go')).toBe('go')
  })

  it('最近挑的那门在该板块没有内容时，回落到已勾选里第一个有内容的', () => {
    // python 基准下目前只有 → java 一个方向有内容
    expect(resolvePairTarget('python', 'pitfalls', ['go', 'java'], 'go')).toBe('java')
  })

  it('勾选的都没内容时，回落到该板块第一个可用方向', () => {
    expect(resolvePairTarget('python', 'pitfalls', ['go', 'rust'], null)).toBe('java')
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
  it('基础语法：目标基准有同一章就留在那一章', () => {
    expect(resolveSwitchPath('javascript', { section: 'basics', key: '01-variables' })).toBe(
      '/compare/javascript/basics/01-variables',
    )
    // python 基准补齐到 8 章之后，同名章节也该保留 —— 而不是一律回落到首章
    expect(resolveSwitchPath('python', { section: 'basics', key: '06-objects' })).toBe(
      '/compare/python/basics/06-objects',
    )
  })

  it('基础语法：目标基准没有那一章就落到它的首章', () => {
    // java 基准目前只有 01-variables（python 基准已补齐 8 章，见上一条）
    expect(resolveSwitchPath('java', { section: 'basics', key: '06-objects' })).toBe(
      '/compare/java/basics/01-variables',
    )
  })

  it('迁移教程：同一章 slug 能保留就保留', () => {
    expect(resolveSwitchPath('python', { section: 'migration', key: '01-functions' })).toBe(
      '/compare/python/migration/01-functions',
    )
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

  it('非对比页（section 为 null）落到该基准的基础语法首章', () => {
    expect(resolveSwitchPath('java', { section: null, key: null })).toBe(
      sectionEntryPath('java', 'basics'),
    )
  })

  it('每个基准候选都有可去的落点', () => {
    for (const id of baselineLanguageIds) {
      expect(resolveSwitchPath(id, { section: null, key: null })).not.toBe('/404')
    }
  })
})

describe('全局选择：diff 按基准重算', () => {
  it('缓存 key 含 (feature, 基准, 目标)——换基准不会读到上一个基准的结果', () => {
    const jsCode = 'const a = 1\nconsole.log(a)'
    const pyCode = 'a = 1\nprint(a)'

    const jsToPy = getCachedDiff('f1|javascript|python', jsCode, pyCode)
    const pyToJs = getCachedDiff('f1|python|javascript', pyCode, jsCode)

    expect(pyToJs).not.toBe(jsToPy)
    expect(getCachedDiff('f1|javascript|python', jsCode, pyCode)).toBe(jsToPy)
  })

  it('两个方向的差异结果确实不同 —— 基准可切意味着 diff 可切', () => {
    const jsCode = 'const a = 1\nconsole.log(a)'
    const pyCode = 'a = 1\nprint(a)'

    const jsToPy = getCachedDiff('f2|javascript|python', jsCode, pyCode)
    const pyToJs = getCachedDiff('f2|python|javascript', pyCode, jsCode)

    expect(jsToPy.total).toBe(pyCode.split('\n').length)
    expect(pyToJs.total).toBe(jsCode.split('\n').length)
    expect(jsToPy.changed.size).toBe(2)
    expect(pyToJs.changed.size).toBe(2)
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

  it('基础语法是基准级的：三个基准候选各有一套，且都不带 target', () => {
    for (const id of baselineLanguageIds) {
      const topic = manifest.topics.find((t) => t.section === 'basics' && t.baseline === id)
      expect(topic, `${id} 缺少基础语法`).toBeTruthy()
      expect(topic?.target).toBeUndefined()
    }
  })
})
