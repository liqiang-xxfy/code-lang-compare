/**
 * 池 + 每基准章节分组的装载器（S6.5a）—— 对**真实** content/ 断言。
 *
 * 钉住的是本次改动最核心的那条性质：**章节分组随基准变，而内容不随**。
 * 这里的断言同时是「两步并存」的回归闸门 —— 新装载器读 `catalog/<板块>/`，
 * 旧装载器读 `catalog/*.yaml`，两边都不能越界。
 */
import { describe, expect, it } from 'vitest'
import {
  groupsOfPool,
  listLanguageGroupFiles,
  loadAllLanguageMeta,
  loadBaselineCatalogs,
  loadFeaturePools,
  loadPairListsV2,
  loadPoolLanguageContent,
} from '../../scripts/lib/core'
import {
  baselineCatalogSchema,
  boxSchema,
  featurePoolSchema,
  languageContentFileSchema,
  pairMetaSchema,
} from '../../src/schemas'

const baselineIds = loadAllLanguageMeta()
  .filter((m) => m.baseline)
  .map((m) => m.id)

const { pools, issues: poolIssues } = loadFeaturePools()
const { catalogs, issues: catalogIssues } = loadBaselineCatalogs(baselineIds)

const express = pools.find((p) => p.section === 'express')
if (!express) throw new Error('没有读到 express 的 feature 池')
const expressPool = express

/** 该基准在 express 板块下，每个 feature id 落在哪一章 */
function chapterOfFeature(baseline: string, featureId: string): string | null {
  const catalog = catalogs.find((c) => c.section === 'express' && c.baseline === baseline)
  if (!catalog) return null
  for (const ch of catalog.chapters) {
    if (ch.features.includes(featureId)) return ch.id
  }
  return null
}

describe('feature 池装载（loadFeaturePools）', () => {
  it('读到 express 的池，文件名与 section 字段一致', () => {
    expect(poolIssues).toEqual([])
    expect(expressPool.title).toBe('基础表达')
  })

  it('池内 feature id 唯一 —— 它是全局 feature id 的第二段', () => {
    const ids = expressPool.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个 feature 都声明了 group（存放组）', () => {
    for (const f of expressPool.features) {
      expect(f.group, f.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('存放组去重后保持首次出现的顺序', () => {
    expect(groupsOfPool(expressPool)).toEqual([
      'bindings',
      'values',
      'operators',
      'control-flow',
      'functions',
      'strings',
      'containers',
    ])
  })

  it('池里没有 order 字段 —— 池的顺序不表达任何东西', () => {
    for (const f of expressPool.features) expect(f).not.toHaveProperty('order')
  })
})

describe('章节分组装载（loadBaselineCatalogs）', () => {
  it('文件名与 baseline 字段一致，且都是基准候选', () => {
    expect(catalogIssues).toEqual([])
    for (const c of catalogs) expect(baselineIds).toContain(c.baseline)
  })

  it('四个板块 × 三个基准的分组都在 —— 骨架期一次落齐，内容按批补', () => {
    const keyed = catalogs.map((c) => `${c.section}/${c.baseline}`).sort()
    expect(keyed).toEqual(
      [
        'express/javascript',
        'express/python',
        'express/java',
        'model/javascript',
        'model/python',
        'model/java',
        'mechanism/javascript',
        'mechanism/python',
        'mechanism/java',
        'practice/javascript',
        'practice/python',
        'practice/java',
      ].sort(),
    )
  })

  it('引用的 feature id 全部能在**本板块**的池里解析 —— 拼错会静默丢行', () => {
    // 必须按板块取池：feature id 只在板块内唯一，跨板块同名（如 express 与 model
    // 都有 collections 章）是合法的，拿错池子会得出相反的结论
    const knownOf = new Map(pools.map((p) => [p.section, new Set(p.features.map((f) => f.id))]))
    for (const c of catalogs) {
      const known = knownOf.get(c.section)
      expect(known, `没有 ${c.section} 的池`).toBeTruthy()
      for (const ch of c.chapters) {
        for (const id of ch.features) {
          expect(known!.has(id), `${c.section}/${c.baseline} 的 '${ch.id}' 引用了不存在的 ${id}`).toBe(true)
        }
      }
    }
  })

  it('章节 id 只在「该基准 × 该板块」内唯一 —— 跨板块同名是合法的', () => {
    for (const c of catalogs) {
      const ids = c.chapters.map((ch) => ch.id)
      expect(new Set(ids).size, `${c.section}/${c.baseline}`).toBe(ids.length)
    }
  })

  it('同一基准下，一个 feature 不会出现在两个章里', () => {
    for (const c of catalogs) {
      const seen = new Set<string>()
      for (const ch of c.chapters) {
        for (const id of ch.features) {
          expect(seen.has(id), `${c.baseline} 的 ${id} 重复出现`).toBe(false)
          seen.add(id)
        }
      }
    }
  })
})

describe('章节分组随基准变，内容不随', () => {
  it('hoisting 只在 JavaScript 的分组里 —— Python 视角下取舍掉了', () => {
    expect(chapterOfFeature('javascript', 'hoisting')).toBe('bindings')
    expect(chapterOfFeature('python', 'hoisting')).toBeNull()
  })

  it('equality 在 JS 落在运算符章、在 Python 落在值与类型章', () => {
    expect(chapterOfFeature('javascript', 'equality')).toBe('operators')
    expect(chapterOfFeature('python', 'equality')).toBe('values')
  })

  it('两个基准对同一批 feature 给出不同的章节名', () => {
    const js = catalogs.find((c) => c.section === 'express' && c.baseline === 'javascript')
    const py = catalogs.find((c) => c.section === 'express' && c.baseline === 'python')
    const titles = (c: typeof js) => c!.chapters.map((ch) => ch.title)
    expect(titles(js)).not.toEqual(titles(py))
  })

  it('而内容文件与基准无关 —— 路径第三段是存放组，不是任何基准的章节名', () => {
    const js = loadPoolLanguageContent('javascript', pools)
    // 文件数是「写过的存放组数」，随内容爬坡增长 —— 断言形状而不是条数
    expect(js.length).toBeGreaterThan(0)
    for (const g of js) {
      expect(g.file.replace(/\\/g, '/')).toMatch(
        new RegExp(`languages/javascript/${g.section}/${g.group}\\.yaml$`),
      )
      // 存放组必须来自**本板块的池**（与基准无关的那一层），不是某个基准的章节 id
      const pool = pools.find((p) => p.section === g.section)!
      expect(pool, `没有 ${g.section} 的池`).toBeTruthy()
      expect(groupsOfPool(pool)).toContain(g.group)
    }
    const bindings = js.find((g) => g.group === 'bindings')!
    expect(Object.keys(bindings.boxes).sort()).toEqual([
      'declaration',
      'hoisting',
      'mutability',
      'naming-convention',
      'scope',
      'shadowing',
    ])
  })

  it('box 的 key 必须是池里该存放组的 feature —— 别的组的 key 会被 R21 拦住', () => {
    // 必须按 (板块, 存放组) 取成员：同一个组名可以出现在不同板块的池里
    // （如 express 与 model 都有 collections 之外的同名情况），拿错池会得出相反结论
    const membersOf = (section: string, group: string) => {
      const pool = pools.find((p) => p.section === section)!
      return new Set(pool.features.filter((f) => f.group === group).map((f) => f.id))
    }
    for (const lang of ['javascript', 'python']) {
      const files = loadPoolLanguageContent(lang, pools)
      expect(files.length).toBeGreaterThan(0)
      for (const g of files) {
        const members = membersOf(g.section, g.group)
        expect(members.size, `${g.section}/${g.group} 在池里没有成员`).toBeGreaterThan(0)
        for (const key of Object.keys(g.boxes)) expect(members.has(key), `${lang}/${key}`).toBe(true)
      }
    }
  })
})

describe('私有目录约定', () => {
  it('_template 默认不参与装载', () => {
    expect(loadPoolLanguageContent('_template', pools)).toEqual([])
  })

  it('显式要求时能读到（作者靠它当脚手架）', () => {
    const tpl = loadPoolLanguageContent('_template', pools, { includePrivate: true })
    // 四个板块各示范一个存放组 —— 脚手架要覆盖骨架的全部形状
    expect(tpl.map((g) => `${g.section}/${g.group}`).sort()).toEqual([
      'express/bindings',
      'mechanism/types',
      'model/errors',
      'practice/testing',
    ])
  })

  it('孤儿扫描跳过 snippets/ 与 `_` 前缀目录', () => {
    const files = listLanguageGroupFiles('javascript')
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(f.section).not.toBe('snippets')
      expect(f.section.startsWith('_')).toBe(false)
      expect(f.group).toBeTruthy()
    }
  })
})

describe('语言内容装载的细节', () => {
  it('归属全部由路径派生：section 取目录、group 取文件名', () => {
    for (const g of loadPoolLanguageContent('javascript', pools)) {
      expect(g.file.replace(/\\/g, '/')).toContain(`/${g.section}/${g.group}.yaml`)
    }
  })

  it('文件级 review 被补齐到每一格', () => {
    const py = loadPoolLanguageContent('python', pools)
    expect(py.length).toBeGreaterThan(0)
    for (const g of py) {
      for (const box of Object.values(g.boxes)) {
        expect(box.review.state, `${g.group}`).toBe('draft')
        expect(box.review.provenance.origin).toBe('llm')
      }
    }
  })

  /*
   * 一份内容文件里同时住着两套说法（ADR-44）：
   *   baseline  —— 这门语言作**基准列**时显示
   *   vs.<基准> —— 这门语言作**对比列**时显示
   * 三门基准候选都写满，才能保证「切到任何一门基准，另外两列都有话可说」（R22）。
   */
  it('两套角色都读得进来：baseline（基准列）与 vs.<基准 id>（对比列）', () => {
    for (const lang of ['javascript', 'python', 'java']) {
      const box = loadPoolLanguageContent(lang, pools)[0]!.boxes.declaration!
      expect(box.baseline, `${lang} 缺 baseline`).toBeTruthy()
      for (const base of ['javascript', 'python', 'java'].filter((b) => b !== lang)) {
        expect(box.vs[base], `${lang} 缺 vs.${base}`).toBeTruthy()
      }
      // 自指没有意义：一门语言不为自己写差异说明
      expect(box.vs[lang], `${lang} 不该给自己写 vs`).toBeUndefined()
    }
  })

  it('absent 的格子被如实读出（与「还没写」可区分）', () => {
    const py = loadPoolLanguageContent('python', pools)[0]!.boxes
    expect(py.hoisting!.absent).toBe(true)
    expect(py.hoisting!.vs.javascript).toBeTruthy()
  })

  it('没有内容的语言被跳过，而不是抛错', () => {
    /*
     * 这条要**从当前状态派生**，不能钉死某一门语言 ——
     * 「哪几门还没写内容」在 S7 爬坡期每批都在变（rust / go 在 S7.5 之前也是空的）。
     * 稳定的事实是：只声明了 meta.yaml、没有启用也没有内容目录的语言永远是空的。
     */
    const metaOnly = ['typescript', 'arkts', 'kotlin', 'swift', 'dart']
    const empty = metaOnly.filter((id) => listLanguageGroupFiles(id).length === 0)
    expect(empty.length, 'meta-only 语言列表已失效，请同步').toBeGreaterThan(0)
    for (const id of empty) {
      expect(loadPoolLanguageContent(id, pools), id).toEqual([])
    }
    // 反向：有内容文件的语言必须被读出来，不能静默丢成空
    for (const id of ['javascript', 'python', 'java']) {
      expect(loadPoolLanguageContent(id, pools).length, id).toBeGreaterThan(0)
    }
  })

  it('非基准语言（对比列）没有 baseline，但三份 vs 写全', () => {
    /*
     * 架构 §4.4 规则 4：非基准语言的 `baseline` 可以省略 —— 它们永远不会被渲染成基准列。
     * rust / go 是第一批这样的语言（S7.5）。此后每新增一门对比列语言都要登记进下面这个数组，
     * 否则它不受这条契约保护 —— 注意它对空内容 `continue`，漏登记不会报错，只会静默失守。
     */
    for (const id of [
      'rust',
      'go',
      'typescript',
      'arkts',
      'kotlin',
      'swift',
      'dart',
      'cpp',
      'php',
    ]) {
      const groups = loadPoolLanguageContent(id, pools)
      if (groups.length === 0) continue // 还没开写，跳过（爬坡期）
      for (const g of groups) {
        for (const [featureId, box] of Object.entries(g.boxes)) {
          const where = `${id}/${g.section}/${g.group} → ${featureId}`
          expect(box.baseline, `${where} 不该有 baseline`).toBeUndefined()
          for (const base of ['javascript', 'python', 'java']) {
            expect(box.vs[base], `${where} 缺 vs.${base}`).toBeTruthy()
          }
          expect(box.vs[id], `${where} 不该给自己写 vs`).toBeUndefined()
        }
      }
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

  it('meta.yaml 缺失不报错 —— 刚建立的方向目录还没补留痕是合法的', () => {
    const r = loadPairListsV2()
    expect(r.issues).toEqual([])
    // 键恒存在（值可能是 undefined）：loader 不会因缺文件而中断，也不会漏读存在的文件
    for (const p of r.pairs) expect('meta' in p).toBe(true)
  })

  it('方向 meta.yaml 的 review 会被解析出来，而不是被静默丢弃', () => {
    const raw = {
      review: {
        state: 'draft',
        provenance: {
          origin: 'llm',
          model: 'claude-code-agent',
          promptTemplateId: 'pairs-v2-batch',
          generatedAt: '2026-10-03',
        },
      },
    }
    // 三个 pairs schema 都不是 .strict()，没写进 schema 的字段会被无声剥掉 —— 这条钉住它被接住了
    const parsed = pairMetaSchema.parse(raw)
    expect(parsed.review.provenance.origin).toBe('llm')
    expect(parsed.review.state).toBe('draft')
    // review 是必填：空 meta 是写错了，不是「还没写」
    expect(pairMetaSchema.safeParse({}).success).toBe(false)
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

  it('语言内容文件顶层重复声明归属会被 .strict() 拒绝', () => {
    expect(languageContentFileSchema.safeParse({ section: 'express', boxes: {} }).success).toBe(
      false,
    )
    expect(languageContentFileSchema.safeParse({ group: 'bindings', boxes: {} }).success).toBe(
      false,
    )
  })
})

describe('新 schema 的自洽约束', () => {
  it('池的 feature 必须给 group', () => {
    const pool = { section: 'express', title: 'x', features: [{ id: 'a', title: 'A', kind: 'syntax' }] }
    expect(featurePoolSchema.safeParse(pool).success).toBe(false)
  })

  it('章节分组必须声明 section 与 baseline，且拒绝未知字段', () => {
    const ok = {
      section: 'express',
      baseline: 'javascript',
      chapters: [{ id: 'a', title: 'A', features: ['x'] }],
    }
    expect(baselineCatalogSchema.safeParse(ok).success).toBe(true)
    expect(baselineCatalogSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    expect(baselineCatalogSchema.safeParse({ section: 'express', chapters: ok.chapters }).success).toBe(
      false,
    )
  })

  it('章节分组的 features 是 id 引用，不内联 feature 对象', () => {
    const bad = {
      section: 'express',
      baseline: 'javascript',
      chapters: [{ id: 'a', title: 'A', features: [{ id: 'x', title: 'X', kind: 'syntax' }] }],
    }
    expect(baselineCatalogSchema.safeParse(bad).success).toBe(false)
  })
})
