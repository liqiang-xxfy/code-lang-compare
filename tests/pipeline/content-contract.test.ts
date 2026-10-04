/**
 * 内容契约测试 —— 让「规则」本身可回归，断言**仓库真实内容**必须满足的不变量。
 *
 * 它是继 `content:validate` 之后的第二道闸门：脚本被改坏时测试未必发现，
 * 而对真实内容的断言会先红。
 */
import { describe, expect, it } from 'vitest'
import { analyzeContent, globalIdOf } from '../../scripts/lib/analyze'
import { loadRegistry } from '../../scripts/lib/core'
import { baselineCatalogSchema, languageContentFileSchema } from '../../src/schemas'

const a = analyzeContent()

describe('内容不变量（对真实 content/ 目录断言）', () => {
  it('没有任何 error 级校验问题', () => {
    const errors = a.issues.filter((i) => i.level === 'error')
    expect(errors, errors.map((e) => `${e.rule} ${e.where}: ${e.message}`).join('\n')).toEqual([])
  })

  it('每个板块的池与章节分组都在 registry 注册，且分组通过契约校验', () => {
    for (const p of a.pools) {
      expect(a.registry.sections[p.section], `未注册的板块 ${p.section}`).toBeDefined()
    }
    for (const c of a.catalogs) {
      expect(a.registry.sections[c.section], `未注册的板块 ${c.section}`).toBeDefined()
      expect(baselineCatalogSchema.safeParse(c).success).toBe(true)
    }
  })

  it('全局 feature id 形如 <板块>/<feature> 且全局唯一', () => {
    const seen = new Set<string>()
    for (const f of a.features) {
      expect(f.id).toBe(globalIdOf(f.section, f.feature.id))
      expect(f.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/)
      expect(seen.has(f.id), `feature id 重复：${f.id}`).toBe(false)
      seen.add(f.id)
    }
    expect(seen.size).toBe(a.features.length)
  })

  /**
   * 本文件最承重的一条。
   *
   * `features` / `featureIndex` 必须**从池构建**：一旦改成遍历章节分组，
   * 同一批知识点会被每个基准各插一次 —— 大小翻倍、id 报重复、覆盖率全乱。
   * 这条断言就是那个翻转的探针。
   */
  it('featureIndex 与知识点清单一一对应 —— 它来自池，不是遍历章节分组数出来的', () => {
    const poolSize = a.pools.reduce((n, p) => n + p.features.length, 0)
    expect(Object.keys(a.featureIndex).length).toBe(poolSize)
    expect(poolSize).toBeGreaterThan(0)
    // 章节分组的引用总量远大于池（同一知识点被多个基准各引用一次）—— 这正是不能遍历它的原因
    const refs = a.catalogs.reduce((n, c) => n + c.chapters.reduce((m, ch) => m + ch.features.length, 0), 0)
    expect(refs).toBeGreaterThan(poolSize)
  })

  it('R21：语言内容文件里的每个 box key 都在**池里该存放组**的 feature 里', () => {
    for (const group of a.content.values()) {
      const pool = a.poolBySection[group.section]
      const known = new Set(
        (pool?.features ?? []).filter((f) => f.group === group.group).map((f) => f.id),
      )
      expect(languageContentFileSchema.safeParse({ boxes: group.boxes }).success).toBe(true)
      for (const key of Object.keys(group.boxes)) {
        expect(known.has(key), `${group.file} 里的 '${key}' 不在池的该存放组里`).toBe(true)
      }
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
    expect([...a.enabledLanguageIds].sort()).toEqual([
      'arkts',
      'cpp',
      'dart',
      'go',
      'java',
      'javascript',
      'kotlin',
      'php',
      'python',
      'rust',
      'swift',
      'typescript',
    ])
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

  it('章节分组里只有基准语言 —— 章节分类是「给谁看的」，只能挂在基准上', () => {
    for (const c of a.catalogs) {
      expect(a.baselineIds, `${c.baseline} 不是基准候选`).toContain(c.baseline)
    }
  })

  it('顺序由数组位置表达 —— 池与章节分组都没有 order 字段', () => {
    for (const c of a.catalogs) {
      for (const ch of c.chapters) expect(ch).not.toHaveProperty('order')
    }
    for (const p of a.pools) {
      for (const f of p.features) expect(f).not.toHaveProperty('order')
    }
  })

  it('ADR-45 / ADR-68：速查三兄弟保留方向性，陷阱与词典都只讲本方向的两门语言', () => {
    expect(a.pairs.length).toBeGreaterThan(0)
    for (const pair of a.pairs) {
      const allowed = new Set([pair.baseline, pair.target])
      for (const g of pair.glossary) {
        for (const lang of Object.keys(g.perLanguage)) {
          expect(allowed.has(lang), `${g.term} 的 perLanguage 含第三门语言 ${lang}`).toBe(true)
        }
      }
      // 陷阱的 languages 曾经只查「语言存不存在」，于是能悄悄多写一门第三语言
      for (const p of pair.pitfalls) {
        for (const lang of p.languages) {
          expect(allowed.has(lang), `${p.id} 的 languages 含第三门语言 ${lang}`).toBe(true)
        }
      }
    }
  })

  it('契约会拒绝「顶层重复声明归属」这类能表达但无意义的写法', () => {
    // boxes 的 key 是 record，拼错的 key 由 R21 兜；归属一律由路径派生，写了就报错
    expect(languageContentFileSchema.safeParse({ section: 'express', boxes: {} }).success).toBe(false)
    expect(languageContentFileSchema.safeParse({ group: 'bindings', boxes: {} }).success).toBe(false)
    // 全局 id 必须是两段 —— 带章节段的三段形态不再是合法 id（章节随基准变）
    expect(a.features.every((f) => f.id.split('/').length === 2)).toBe(true)
  })
})

/* ────────────── 速查正文的写作口径 ──────────────
 *
 * 速查三兄弟的正文是**散文**：`perLanguage` 的键有 R5 守着，
 * 而 `symptom` / `cause` / `fix` / `note` / `todo` / `acceptance` 里的字**没有任何规则在看**。
 * 「提到的板块名必须真实存在」这条口径由下面的断言守着 —— 它抓的是从 v1 搬过来的
 * 「心智模型」/「基础语法」这类死引用（那两个板块 v2 里都不存在）。
 *
 * 曾经的另一条「只讲本方向两门语言」已随 ADR-72 废除（原编号 R25 的幽灵语言口径）。
 */
describe('速查正文的写作口径', () => {
  const sectionLabels = new Set(Object.values(loadRegistry().sections).map((s) => s.label))

  /** 一个方向里全部面向读者的文字。**url 除外** —— 域名与路径里本来就有语言名 */
  function readerFacingTexts(pair: (typeof a.pairs)[number]): string[] {
    const out: string[] = []
    for (const p of pair.pitfalls) out.push(p.title, p.symptom, p.cause, p.fix)
    for (const g of pair.glossary) {
      out.push(g.term, ...g.aliases, ...Object.values(g.perLanguage))
      if (g.note) out.push(g.note)
    }
    for (const s of pair.roadmaps) {
      out.push(s.title, ...s.todo, ...s.acceptance, ...s.resources.map((r) => r.label))
      if (s.durationHint) out.push(s.durationHint)
    }
    return out
  }

  it('提到的板块名必须是注册表里真实存在的板块', () => {
    for (const pair of a.pairs) {
      for (const text of readerFacingTexts(pair)) {
        for (const m of text.matchAll(/「([^」]{1,12})」板块/g)) {
          expect(sectionLabels.has(m[1]!), `${pair.dir} 提到不存在的板块「${m[1]}」`).toBe(true)
        }
      }
    }
  })
})
