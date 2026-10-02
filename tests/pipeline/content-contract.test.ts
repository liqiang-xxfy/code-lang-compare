import { describe, expect, it } from 'vitest'
import { analyzeContent } from '../../scripts/lib/analyze'
import {
  languageMetaSchema,
  provenanceSchema,
  snippetSchema,
} from '../../src/schemas'

/**
 * 内容契约测试 —— 让「规则」本身可回归。
 *
 * 光有 validate 脚本不够：脚本本身可能被改坏。这里断言的是**仓库里真实的内容**
 * 必须满足这些不变量，所以任何一次内容改动跑 npm test 就能立刻发现问题。
 */
describe('内容不变量（对真实 content/ 目录断言）', () => {
  const a = analyzeContent()

  it('没有任何 error 级校验问题', () => {
    const errors = a.issues.filter((i) => i.level === 'error')
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0)
  })

  it('已启用语言对每个 Feature 都有实现（不允许空洞）', () => {
    for (const [lang, c] of Object.entries(a.stats.coverage)) {
      expect(c.have, `${lang} 覆盖率不完整`).toBe(c.total)
    }
  })

  it('每条实现的出处都完整（llm 不填 license，其余必须有 license）', () => {
    for (const [, bucket] of a.snippets) {
      for (const [lang, s] of bucket) {
        if (!a.enabledLanguageIds.includes(lang)) continue
        const p = s.review.provenance
        if (p.origin === 'llm') {
          expect(p).not.toHaveProperty('license')
          expect(p).toHaveProperty('model')
          expect(p).toHaveProperty('promptTemplateId')
        } else {
          expect(p).toHaveProperty('license')
        }
      }
    }
  })

  it('所有被使用的非 llm 来源都在许可台账里，且都有履行位置', () => {
    const origins = new Set(
      [...a.snippets.values()]
        .flatMap((bucket) => [...bucket.entries()])
        .filter(([lang]) => a.enabledLanguageIds.includes(lang))
        .map(([, s]) => s.review.provenance.origin),
    )
    for (const origin of origins) {
      if (origin === 'llm') continue
      const entry = a.attributions.find((e) => e.sourceId === origin)
      expect(entry, `来源 ${origin} 没进台账`).toBeDefined()
      expect(entry!.fulfilledAt.length).toBeGreaterThan(0)
    }
  })

  it('@note 标记全部被解析（没有残留的 @note 文本）', () => {
    const leftOver = a.issues.filter((i) => i.rule === 'R4' && i.level === 'error')
    expect(leftOver).toHaveLength(0)
  })

  it('每个 Feature 的 id 前缀与其 chapter 的 topicId 一致', () => {
    for (const { feature, chapter } of a.features) {
      expect(feature.id.split('/')[0]).toBe(chapter.topicId)
    }
  })
})

/**
 * 说明写在哪一层 —— 「多列板块下沉到每列，单列板块留在 feature」。
 *
 * 这条边界很容易在内容迭代里被磨掉：随手给一条 feature 补个 body，多列页面上
 * 就会出现一块横跨所有列的共享说明（矩阵视图里还完全看不到它）。R18/R19 是
 * **过渡期 warn**（正文要按 topic 分批补，红了没意义），所以真实内容的不变量
 * 由这里钉住。判据一律读板块注册表的 `columns`，不写死板块名。
 */
describe('body 归属：多列板块下沉到每列', () => {
  const a = analyzeContent()
  const isMulti = (topicId: string): boolean => {
    const section = a.registry.topics[topicId]?.section
    return section ? a.registry.sections[section]?.columns === 'multi' : false
  }
  const multiFeatures = a.features.filter(({ chapter }) => isMulti(chapter.topicId))

  it('多列板块不再有共享说明 feature.body', () => {
    const left = multiFeatures
      .filter(({ feature }) => feature.body?.trim())
      .map(({ feature }) => feature.id)
    expect(left, '这些共享说明还没下沉到每列 snippet.body').toEqual([])
  })

  it('多列板块基准列的每一格都有 body（本语言的客观事实）', () => {
    const missing: string[] = []
    for (const { feature, chapter } of multiFeatures) {
      const baseline = a.registry.topics[chapter.topicId]!.baseline
      if (!a.snippets.get(feature.id)?.get(baseline)?.body?.trim()) missing.push(feature.id)
    }
    expect(missing, '基准列缺少 body —— 列下方的说明是这一列唯一的正文').toEqual([])
  })

  it('多列板块没有 kind: exercise（题面机制只存在于单列板块）', () => {
    const bad = multiFeatures
      .filter(({ feature }) => feature.kind === 'exercise')
      .map(({ feature }) => feature.id)
    expect(bad, '多列板块没有「一条共享题面」的位置').toEqual([])
  })

  it('单列板块（migration）仍保留 feature.body —— 范围边界', () => {
    const kept = a.features.filter(
      ({ chapter, feature }) => !isMulti(chapter.topicId) && Boolean(feature.body?.trim()),
    )
    expect(kept.length).toBeGreaterThan(0)
  })

  it('exercise 的题面仍由 feature.body 承载', () => {
    for (const { feature } of a.features) {
      if (feature.kind !== 'exercise') continue
      expect(feature.body?.trim(), `${feature.id} 是练习却没有题面`).toBeTruthy()
    }
  })
})

describe('架构决策的可执行断言', () => {
  const a = analyzeContent()

  it('D-D：ArkTS 是独立语言身份，不与 TypeScript 合并', () => {
    expect(a.allLanguageIds).toContain('arkts')
    expect(a.allLanguageIds).toContain('typescript')
    const arkts = a.metaById.arkts!
    expect(arkts.id).toBe('arkts')
    expect(arkts.name).toBe('ArkTS')
    // 它的独立价值在于「同语法、不同运行时」，所以 metadata 必须能表达运行时差异
    expect(arkts.metadata?.runtime).toBeTruthy()
    expect(arkts.metadata?.supersetOf).toBe('TypeScript')
    // 不能因为共享 shikiLang 就当成同一门语言
    expect(arkts.shikiLang).toBe('typescript')
    expect(arkts.id).not.toBe('typescript')
  })

  it('D-C：默认基准始终是 JavaScript；已启用集合与接入进度一致', () => {
    // D-C 的核心不是「只启用两门」，而是「以 JS 为默认锚点、分段交付」。
    // 这个断言刻意写成**精确集合**：任何语言的启用/停用都必须在这里显式体现，
    // 形成一次有意的摩擦 —— 而不是让架构决策悄悄漂移。
    //
    // 注意 defaultBaseline（唯一默认值）与 baseline 候选（可多门的参照系集合）
    // 是两件事，后者在下一个用例里断言。
    expect(a.registry.defaultBaseline).toBe('javascript')
    expect([...a.enabledLanguageIds].sort()).toEqual([
      'go',
      'java',
      'javascript',
      'python',
      'rust',
    ])
  })

  it('P5：新增语言已全量接入（覆盖率由 R2 保证，这里钉住「已启用」这件事）', () => {
    for (const id of ['java', 'rust', 'go']) {
      expect(a.enabledLanguageIds).toContain(id)
      // 每门新语言都必须有完整 meta：注释符驱动 @note 解析、shikiLang 驱动高亮
      expect(a.metaById[id]?.comment.line).toBeTruthy()
      expect(a.metaById[id]?.shikiLang).toBe(id)
    }
    // 其余语言仍未启用，等后续接入
    for (const id of ['typescript', 'arkts', 'kotlin', 'swift', 'dart']) {
      expect(a.enabledLanguageIds).not.toContain(id)
    }
  })

  it('基准候选 = JS / Python / Java，全部已启用，且默认基准在候选之中', () => {
    // 「谁能当基准」与「默认选谁」是两个独立概念，必须分开钉住：
    // 前者是可多门的参考系集合（meta.baseline: true），后者是唯一的 defaultBaseline。
    const candidates = a.metas
      .filter((m) => m.baseline)
      .map((m) => m.id)
      .sort()
    expect(candidates).toEqual(['java', 'javascript', 'python'])
    for (const id of candidates) {
      expect(a.enabledLanguageIds).toContain(id)
    }
    expect(candidates).toContain(a.registry.defaultBaseline)
  })

  it('默认对比语言已启用且不等于默认基准', () => {
    // 拿基准自己当对比列会渲染出一个恒等于基准的空列，所以这条必须钉死。
    // 它取代了 v1 的 equivalenceReference（ADR-24：徽章改为相对本页基准，
    // 不再需要一个全局参照系常量）。
    expect(a.enabledLanguageIds).toContain(a.registry.defaultCompareLanguage)
    expect(a.registry.defaultCompareLanguage).not.toBe(a.registry.defaultBaseline)
  })

  it('topic 声明的适用语言都是已知语言', () => {
    // 迁移教程只覆盖 from/to 两门语言，靠 topic.languages 表达。
    // 写错的 id 不会报错、只会让 R2 静默漏算，所以在这里钉住。
    for (const [topicId, cfg] of Object.entries(a.registry.topics)) {
      for (const id of cfg.languages ?? []) {
        expect(a.metaById[id], `topic '${topicId}' 引用了未知语言 '${id}'`).toBeTruthy()
      }
    }
  })

  it('三轴字段自洽：基准级板块无 target，对级板块必有 target 且 ≠ baseline', () => {
    for (const [topicId, cfg] of Object.entries(a.registry.topics)) {
      expect(a.metaById[cfg.baseline], `topic '${topicId}' 的 baseline 未知`).toBeTruthy()
      /*
       * 判据读注册表的 `scope`，不写 `section === 'basics'`。
       *
       * 写死板块名的那版把 basics 当成了「唯一的基准级板块」—— 这是 ADR-28
       * 拆分三属性之前的假设。加第二个基准级板块（心智模型）时，它会报
       * 「对级 topic 'concepts-javascript' 缺 target」，指向的原因完全是错的。
       * 「基准级还是对级」本来就是 scope 回答的问题，测试该问它。
       */
      if (a.registry.sections[cfg.section]?.scope === 'baseline') {
        expect(cfg.target, `基准级 topic '${topicId}' 不该有 target`).toBeUndefined()
      } else {
        expect(cfg.target, `对级 topic '${topicId}' 缺 target`).toBeTruthy()
        expect(cfg.target).not.toBe(cfg.baseline)
        // 对级内容的覆盖率范围必须精确等于这两门语言，多一门会强求不存在的内容，
        // 少一门则会让"缺一格"静默漏检。
        expect([...(cfg.languages ?? [])].sort()).toEqual([cfg.baseline, cfg.target!].sort())
      }
    }
  })

  it('每个基准候选都有一套基础语法，且它的基准资格成立', () => {
    for (const m of a.metas.filter((x) => x.baseline)) {
      const has = Object.values(a.registry.topics).some(
        (cfg) => cfg.section === 'basics' && cfg.baseline === m.id,
      )
      expect(has, `${m.id} 标了 baseline: true 却没有基础语法内容`).toBe(true)
    }
  })

  it('每个对目录都能反查到 registry 里的 (基准, 目标) 组合', () => {
    // 目录名写错会静默不渲染 —— R5 会报，但这里再钉一次，防止规则本身被改坏。
    const declared = new Set(
      Object.values(a.registry.topics)
        .filter((cfg) => cfg.target)
        .map((cfg) => `${cfg.baseline}|${cfg.target}`),
    )
    for (const pair of a.pairs) {
      expect(declared.has(`${pair.baseline}|${pair.target}`), pair.topicId).toBe(true)
    }
  })

  it('对级词典只讲本方向的两门语言', () => {
    for (const pair of a.pairs) {
      const allowed = new Set([pair.baseline, pair.target])
      for (const g of pair.glossary) {
        for (const lang of Object.keys(g.perLanguage)) {
          expect(allowed.has(lang), `${pair.topicId} 的「${g.term}」含 ${lang}`).toBe(true)
        }
      }
    }
  })

  it('ADR-08：llm 来源的 schema 里根本没有 license 字段', () => {
    const parsed = provenanceSchema.safeParse({
      origin: 'llm',
      model: 'x',
      promptTemplateId: 'y',
      generatedAt: '2026-10-01',
      license: 'MIT',
    })
    // 多余字段被 zod 剥掉，而不是被当成合法许可
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).not.toHaveProperty('license')
  })

  it('契约会拒绝「引用不存在的语言」这类结构性错误', () => {
    const bad = {
      featureId: 'a/b',
      equivalence: 'identical',
      code: 'x',
      review: { state: 'draft', provenance: { origin: 'manual', license: 'CC-BY-4.0' } },
    }
    expect(snippetSchema.safeParse(bad).success).toBe(true)
    expect(snippetSchema.safeParse({ ...bad, equivalence: 'same-ish' }).success).toBe(false)
    expect(
      languageMetaSchema.safeParse({ ...a.metaById.python, typing: 'duck' }).success,
    ).toBe(false)
  })
})
