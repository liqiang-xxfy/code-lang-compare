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

  it('equivalence 参照系已声明且是已启用语言', () => {
    // 徽章是人手写的绝对值，无法随基准切换重算 —— 参照系必须是内容级常量，
    // 而且必须指向一门真实启用的语言，否则页面上的说明文案会指向空气。
    expect(a.registry.equivalenceReference).toBeTruthy()
    expect(a.enabledLanguageIds).toContain(a.registry.equivalenceReference)
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
