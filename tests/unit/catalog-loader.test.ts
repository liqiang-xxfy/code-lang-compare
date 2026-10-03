/**
 * v2 装载器（S3）—— 对**真实** content/ 目录断言。
 *
 * 这些断言同时是「增量期两条管线并存」的回归闸门：新装载器必须能读到 v2 内容，
 * 且绝不能把旧的 `snippets/` 布局当成新内容（那会让 S4 的孤儿检测把旧内容整批报错）。
 */
import { describe, expect, it } from 'vitest'
import {
  listLanguageContentFiles,
  loadCatalog,
  loadLanguageContent,
  loadPairListsV2,
} from '../../scripts/lib/core'
import { boxSchema, catalogSchema, languageContentFileSchema } from '../../src/schemas'

const { catalogs, issues } = loadCatalog()

/** 试点章在清单里的 feature id 列表 */
function featureIdsOf(chapterId: string): string[] {
  for (const c of catalogs) {
    const ch = c.chapters.find((x) => x.id === chapterId)
    if (ch) return ch.features.map((f) => f.id)
  }
  throw new Error(`清单里没有章节 ${chapterId}`)
}

describe('清单装载（loadCatalog）', () => {
  it('读到试点清单，且文件名与 section 字段一致', () => {
    expect(catalogs.length).toBeGreaterThan(0)
    expect(issues).toEqual([])
  })

  it('variables 章有 5 个从零设计的 feature', () => {
    expect(featureIdsOf('variables')).toEqual([
      'declaration',
      'mutability',
      'scope',
      'hoisting',
      'shadowing',
    ])
  })

  it('清单里没有 order 字段 —— 顺序的唯一真源是数组位置', () => {
    for (const c of catalogs) {
      expect(c).not.toHaveProperty('order')
      for (const ch of c.chapters) {
        expect(ch).not.toHaveProperty('order')
        for (const f of ch.features) expect(f).not.toHaveProperty('order')
      }
    }
  })
})

describe('语言内容装载（loadLanguageContent）', () => {
  it('试点语言读到 variables 一章，box 的 key 与清单对齐', () => {
    const js = loadLanguageContent('javascript', catalogs)
    expect(js).toHaveLength(1)
    expect(js[0].lang).toBe('javascript')
    expect(js[0].chapter).toBe('variables')
    expect(Object.keys(js[0].boxes).sort()).toEqual([...featureIdsOf('variables')].sort())
  })

  it('归属全部由路径派生：section / chapter 取自目录与文件名', () => {
    for (const g of loadLanguageContent('javascript', catalogs)) {
      expect(g.file.replace(/\\/g, '/')).toContain(`/${g.section}/${g.chapter}.yaml`)
    }
  })

  it('文件级 review 被补齐到每一格', () => {
    const py = loadLanguageContent('python', catalogs)
    expect(py).toHaveLength(1)
    for (const box of Object.values(py[0].boxes)) {
      expect(box.review.state).toBe('draft')
      expect(box.review.provenance.origin).toBe('llm')
    }
  })

  it('两套角色都读得进来：baseline（基准列）与 vs.<基准 id>（对比列）', () => {
    const js = loadLanguageContent('javascript', catalogs)[0].boxes
    expect(js.declaration.baseline).toBeTruthy()
    expect(js.declaration.vs).toEqual({})

    const py = loadLanguageContent('python', catalogs)[0].boxes
    expect(py.declaration.baseline).toBeUndefined()
    expect(py.declaration.vs.javascript).toBeTruthy()
  })

  it('absent 的格子被如实读出（与「还没写」可区分）', () => {
    const py = loadLanguageContent('python', catalogs)[0].boxes
    expect(py.hoisting.absent).toBe(true)
    expect(py.hoisting.vs.javascript).toBeTruthy()
  })

  it('`_` 前缀私有目录被跳过；脚手架不会被当内容', () => {
    expect(loadLanguageContent('_template', catalogs)).toEqual([])
    // 显式打开时才读到 —— 证明它是被「私有目录」挡住的，而不是文件不存在
    expect(loadLanguageContent('_template', catalogs, { includePrivate: true })).toHaveLength(1)
  })

  it('没有内容文件的章节被跳过，而不是抛错', () => {
    expect(loadLanguageContent('rust', catalogs)).toEqual([])
    expect(loadLanguageContent('go', catalogs)).toEqual([])
  })
})

describe('装载器的边界（不误吃旧布局）', () => {
  it('孤儿扫描跳过旧的 snippets/ 与 `_` 前缀目录', () => {
    const files = listLanguageContentFiles('javascript')
    // S6.5 期间两套布局并存：basics（旧，第 3 步删）与 express（新的存放组布局）
    expect(files.map((f) => f.section).sort()).toEqual(['basics', 'express'])
    for (const f of files) {
      expect(f.section).not.toBe('snippets')
      expect(f.section.startsWith('_')).toBe(false)
    }
  })
})

describe('方向性内容装载（loadPairListsV2）', () => {
  it('读到全部方向，且目录名都能反查出 (基准, 目标)', () => {
    const r = loadPairListsV2()
    expect(r.issues).toEqual([])
    expect(r.pairs.length).toBeGreaterThan(0)
    for (const p of r.pairs) {
      // 目录名必须**恰好一种**拆法 —— 语言 id 允许含数字，简单 split('2') 会挂错方向
      expect(p.dir.replace(/\\/g, '/')).toBe(`content/pairs/${p.baseline}2${p.target}`)
      expect(p.baseline).not.toBe(p.target)
    }
  })

  it('三份列表资源都按契约读出（顶层数组，pair 归属由目录名注入）', () => {
    const r = loadPairListsV2()
    const hit = r.pairs.find((p) => p.pitfalls.length > 0)
    expect(hit).toBeDefined()
    for (const p of hit!.pitfalls) {
      expect(p.baseline).toBe(hit!.baseline)
      expect(p.target).toBe(hit!.target)
    }
  })

  it('未知语言 id 拼成的目录名 → 记入 issues，不静默挂到错误方向', () => {
    // 用真实目录名之外的一对验证解析器：两边都得是已知语言
    const r = loadPairListsV2(['javascript', 'python'])
    // 只认这两门 → java2python / javascript2go 这类都会被报出来
    expect(r.issues.length).toBeGreaterThan(0)
  })
})

describe('对比框契约（R16 的 v2 版）', () => {
  const base = {
    review: {
      state: 'draft' as const,
      provenance: { origin: 'manual' as const, license: 'CC-BY-4.0' as const },
    },
  }

  it('code 与 blocks 不能并存', () => {
    const r = boxSchema.safeParse({
      ...base,
      code: 'x = 1',
      blocks: [{ label: '写法一', code: 'x = 1' }],
    })
    expect(r.success).toBe(false)
  })

  it('absent 的格子可以三槽全空 —— 旧的「至少一个」已删除', () => {
    expect(boxSchema.safeParse({ ...base, absent: true }).success).toBe(true)
  })

  it('既无代码也未标 absent 时 schema 不拦 —— 交给分析期判「疑似漏写」', () => {
    expect(boxSchema.safeParse({ ...base }).success).toBe(true)
  })

  it('多段的每一段都必须有非空 label', () => {
    expect(boxSchema.safeParse({ ...base, blocks: [{ label: '  ', code: 'x' }] }).success).toBe(
      false,
    )
  })

  it('语言内容文件顶层重复声明 section / chapter 会被 .strict() 拒绝', () => {
    expect(languageContentFileSchema.safeParse({ section: 'basics', boxes: {} }).success).toBe(
      false,
    )
  })

  it('清单顶层也不接受未知字段', () => {
    expect(catalogSchema.safeParse({ ...catalogs[0], topics: [] }).success).toBe(false)
  })
})
