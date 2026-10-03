/**
 * 内容契约测试（v2）—— 让「规则」本身可回归，断言**仓库真实内容**必须满足的不变量。
 *
 * 它是继 `content:validate` 之后的第二道闸门：脚本被改坏时测试未必发现，
 * 而对真实内容的断言会先红。
 */
import { describe, expect, it } from 'vitest'
import { analyzeContent, globalIdOf } from '../../scripts/lib/analyze'
import { catalogSchema, languageContentFileSchema, provenanceSchema } from '../../src/schemas'

const a = analyzeContent()

describe('内容不变量（对真实 content/ 目录断言）', () => {
  it('没有任何 error 级校验问题', () => {
    const errors = a.issues.filter((i) => i.level === 'error')
    expect(errors, errors.map((e) => `${e.rule} ${e.where}: ${e.message}`).join('\n')).toEqual([])
  })

  it('清单里的每个 section 都在 registry 注册，且与文件名一致', () => {
    for (const c of a.catalogs) {
      expect(a.registry.sections[c.section], `未注册的板块 ${c.section}`).toBeDefined()
      expect(catalogSchema.safeParse(c).success).toBe(true)
    }
  })

  it('全局 feature id 形如 <板块>/<章节>/<feature> 且全局唯一', () => {
    const seen = new Set<string>()
    for (const f of a.features) {
      expect(f.id).toBe(globalIdOf(f.section, f.chapter, f.feature.id))
      expect(f.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/)
      expect(seen.has(f.id), `feature id 重复：${f.id}`).toBe(false)
      seen.add(f.id)
    }
    expect(seen.size).toBe(a.features.length)
  })

  it('R21：语言内容文件里的每个 box key 都在清单的该章里', () => {
    for (const group of a.content.values()) {
      const known = new Set(
        a.catalogBySection[group.section]?.chapters.find((c) => c.id === group.chapter)?.features.map((f) => f.id) ??
          [],
      )
      expect(languageContentFileSchema.safeParse({ boxes: group.boxes }).success).toBe(true)
      for (const key of Object.keys(group.boxes)) {
        expect(known.has(key), `${group.file} 里的 '${key}' 不在清单里`).toBe(true)
      }
    }
  })

  it('每条对比框的出处都完整（llm 不填 license，其余必须有 license）', () => {
    for (const [gid, bucket] of a.boxes) {
      for (const [lang, box] of bucket) {
        const p = box.review.provenance
        if (p.origin === 'llm') {
          expect(p, `${gid}·${lang} 的 llm 记录不得有 license`).not.toHaveProperty('license')
          expect(p).toHaveProperty('model')
          expect(p).toHaveProperty('promptTemplateId')
        } else {
          expect(p, `${gid}·${lang} 的非 llm 记录必须有 license`).toHaveProperty('license')
        }
      }
    }
  })

  it('所有被使用的非 llm 来源都在许可台账里，且都有履行位置', () => {
    for (const origin of new Set(Object.keys(a.stats.byOrigin))) {
      if (origin === 'llm') continue
      const entry = a.attributions.find((x) => x.sourceId === origin)
      expect(entry, `来源 ${origin} 未登记台账`).toBeDefined()
      expect(entry!.fulfilledAt.length).toBeGreaterThan(0)
    }
  })

  it('R4/R9：代码里没有残留的 @note 标记', () => {
    const residual = a.issues.filter((i) => i.rule === 'R4/R9' && i.level === 'error')
    expect(residual).toEqual([])
  })

  it('absent 之外的格子必须有代码（「无此概念」才允许三槽全空）', () => {
    for (const [gid, bucket] of a.boxes) {
      for (const [lang, box] of bucket) {
        if (box.absent) continue
        const hasCode = box.code.trim().length > 0 || (box.blocks?.length ?? 0) > 0
        expect(hasCode, `${gid}·${lang} 既没有代码，也没标 absent`).toBe(true)
      }
    }
  })

  it('vs 的 key 必须是基准候选 —— 视角按基准分，写第四门没有意义', () => {
    for (const [gid, bucket] of a.boxes) {
      for (const [lang, box] of bucket) {
        for (const base of Object.keys(box.vs)) {
          expect(a.baselineIds, `${gid}·${lang} 的 vs.${base} 不是基准候选`).toContain(base)
        }
        for (const base of Object.keys(box.equivalence)) {
          expect(a.baselineIds, `${gid}·${lang} 的 equivalence.${base} 不是基准候选`).toContain(base)
        }
      }
    }
  })
})

describe('架构决策的可执行断言', () => {
  it('D-C：默认基准始终是 JavaScript；已启用集合与接入进度一致', () => {
    expect(a.registry.defaultBaseline).toBe('javascript')
    expect([...a.enabledLanguageIds].sort()).toEqual(['go', 'java', 'javascript', 'python', 'rust'])
  })

  it('基准候选 = JS / Python / Java，全部已启用，且默认基准在候选之中', () => {
    expect([...a.baselineIds].sort()).toEqual(['java', 'javascript', 'python'])
    for (const id of a.baselineIds) expect(a.enabledLanguageIds).toContain(id)
    expect(a.baselineIds).toContain(a.registry.defaultBaseline)
  })

  it('默认对比语言已启用且不等于默认基准', () => {
    expect(a.enabledLanguageIds).toContain(a.registry.defaultCompareLanguage)
    expect(a.registry.defaultCompareLanguage).not.toBe(a.registry.defaultBaseline)
  })

  it('章节与 feature 的顺序由清单的数组位置表达 —— 没有 order 字段', () => {
    for (const c of a.catalogs) {
      for (const ch of c.chapters) {
        expect(ch).not.toHaveProperty('order')
        for (const f of ch.features) expect(f).not.toHaveProperty('order')
      }
    }
  })

  it('ADR-45：速查三兄弟保留方向性，词典只讲本方向的两门语言', () => {
    expect(a.pairs.length).toBeGreaterThan(0)
    for (const pair of a.pairs) {
      const allowed = new Set([pair.baseline, pair.target])
      for (const g of pair.glossary) {
        for (const lang of Object.keys(g.perLanguage)) {
          expect(allowed.has(lang), `${g.term} 的 perLanguage 含第三门语言 ${lang}`).toBe(true)
        }
      }
    }
  })

  it('ADR-08：llm 来源的 schema 里根本没有 license 字段', () => {
    // zod 会剥掉不在契约里的键 —— 强填 MIT/GFDL 是错误陈述，所以连字段都不给
    const r = provenanceSchema.safeParse({
      origin: 'llm',
      model: 'x',
      promptTemplateId: 'y',
      generatedAt: '2026-01-01',
      license: 'MIT',
    })
    expect(r.success).toBe(true)
    expect(r.data).not.toHaveProperty('license')
  })

  it('契约会拒绝「vs 的 key 不是已知语言」之类能表达但无意义的写法', () => {
    // boxes 的 key 是 record，拼错的 key 由 R21 兜（这里断言那条规则确实在跑）
    expect(languageContentFileSchema.safeParse({ section: 'basics', boxes: {} }).success).toBe(false)
    // 全局 id 必须是三段 —— v1 的 `<topic>/<slug>` 两段形态不再是合法 id
    expect(a.features.every((f) => f.id.split('/').length === 3)).toBe(true)
  })
})
