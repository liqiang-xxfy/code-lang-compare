/**
 * 搜索的可执行契约。
 *
 * 重点是**中文检索**：MiniSearch 基于空格分词，中文没有空格，直接用会静默失效
 * （不报错、索引也建得出来，就是搜不到）。这里的断言就是钉住这一点。
 * 另外钉住「构建期与客户端同源」——两边 tokenize 分叉是同一个静默失败。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeContent } from '../../scripts/lib/analyze'
import { buildSearchDocs, buildSearchIndexPayloads } from '../../scripts/pipeline/search-index'
import {
  loadSearchIndex,
  queryOptions,
  toHits,
  type SearchHit,
} from '../../src/content/search'
import { tokenize, tokenizeQuery } from '../../src/content/search-tokenize'

/** 索引按基准分片，默认基准那一份就是用户首访看到的范围 */
const BASELINE = 'javascript'

let search: (q: string) => SearchHit[]
let docCount = 0
let byType: Record<string, number> = {}

beforeAll(() => {
  const analysis = analyzeContent()
  const payloads = buildSearchIndexPayloads(analysis, '2026-10-01T00:00:00.000Z')
  const payload = payloads[BASELINE]!
  const engine = loadSearchIndex(payload.index)
  search = (q: string) =>
    toHits(engine.search(q, queryOptions(BASELINE)) as Array<Record<string, unknown>>)
  docCount = payload.docCount
  byType = payload.byType
})

describe('中文分词', () => {
  it('bigram 让两字词组整体进入索引（Intl.Segmenter 做不到这点）', () => {
    const tokens = tokenize('数组与列表')
    expect(tokens).toContain('数组')
    expect(tokens).toContain('列表')
    // 单字也在，供单字查询使用
    expect(tokens).toContain('数')
  })

  it('拉丁词与数字按整词保留', () => {
    expect(tokenize('let count = 0')).toEqual(['let', 'count', '=', '0'])
  })

  it('代码符号被保留 —— 搜 ?. 是真实需求', () => {
    expect(tokenize('a?.b')).toContain('?.')
    expect(tokenize('x ??= 1')).toContain('??=')
  })

  it('大小写归一', () => {
    expect(tokenize('JSON.Parse')).toEqual(tokenize('json.parse'))
  })

  it('查询侧去掉单汉字，避免把 AND 条件放宽成「含该字即命中」', () => {
    expect(tokenizeQuery('数组')).toEqual(['数组'])
    expect(tokenize('数组')).toContain('数')
  })

  it('单字查询退化为按该字匹配，仍可用', () => {
    expect(tokenizeQuery('值')).toEqual(['值'])
  })
})


/* ────────────────────────── 索引与检索（v2：按语言分片） ────────────────────────── */

const analysis = analyzeContent()
const payloads = buildSearchIndexPayloads(analysis, '2026-10-01T00:00:00.000Z')
const docs = buildSearchDocs(analysis)

/** 装载若干语言分片，返回一个跨分片的检索函数 —— 与 SearchView 的做法一致 */
function searchAcross(langs: readonly string[]) {
  const engines = langs
    .map((id) => payloads[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => loadSearchIndex(p.index) as unknown as ReturnType<typeof loadSearchIndex>)
  return (q: string): SearchHit[] => {
    const merged = engines.flatMap(
      (e) => e.search(q, queryOptions()) as unknown as Array<Record<string, unknown>>,
    )
    merged.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    return toHits(merged)
  }
}

const searchJs = () => searchAcross(['javascript'])
const searchAll = () => searchAcross(['javascript', 'python'])

describe('检索', () => {
  it('中文词能命中（这是默认分词会失败的场景）', () => {
    expect(searchJs()('作用域').length).toBeGreaterThan(0)
  })

  it('长中文词命中高相关条目', () => {
    const hits = searchJs()('声明提升')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.title.includes('提升'))).toBe(true)
  })

  it('注记里的代码标识符可检索', () => {
    // 索引收的是**注记文本**（内容里检索价值最高的部分），不含代码原文 ——
    // 所以出现在注记里的标识符能搜到，只出现在代码里的搜不到（v1 起就是这个口径）
    expect(searchJs()('ReferenceError').length).toBeGreaterThan(0)
  })

  it('「语言名 + 关键词」组合有效（跨分片检索时）', () => {
    // 一个分片只装一门语言的文字，所以带语言名的查询要在**多片一起搜**时才有意义
    expect(searchAll()('python 作用域').length).toBeGreaterThan(0)
  })

  it('AND 语义：多词必须同时命中，不会退化成 OR 的泛召回', () => {
    const broad = searchJs()('作用域').length
    const narrow = searchJs()('作用域 遮蔽').length
    expect(broad).toBeGreaterThan(0)
    expect(narrow).toBeLessThan(broad)
  })

  it('无关查询返回空（不硬凑结果）', () => {
    // 用纯拉丁乱码：含汉字的话会被切成 bigram，可能意外命中真实词组
    expect(searchAll()('zzzqxyz')).toHaveLength(0)
  })

  it('四类内容都进了索引', () => {
    const totals: Record<string, number> = {}
    for (const p of Object.values(payloads)) {
      for (const [type, n] of Object.entries(p.byType)) totals[type] = (totals[type] ?? 0) + n
    }
    for (const type of ['feature', 'pitfall', 'glossary', 'roadmap']) {
      expect(totals[type], `没有 ${type} 类文档`).toBeGreaterThan(0)
    }
  })

  it('结果带可跳转的 url（不能只给标题）', () => {
    for (const hit of searchAll()('作用域').slice(0, 5)) {
      expect(hit.url.startsWith('/')).toBe(true)
      expect(hit.title.length).toBeGreaterThan(0)
    }
  })
})

describe('文档构造', () => {
  it('每条文档 text 都含它所属语言的显示名，使「语言 + 关键词」可召回', () => {
    const features = docs.filter((d) => d.type === 'feature')
    expect(features.length).toBeGreaterThan(0)
    for (const d of features) {
      const name = analysis.metaById[d.lang]?.name ?? d.lang
      expect(d.text, `${d.id} 的正文里没有语言名`).toContain(name)
    }
  })

  it('文档 id 全局唯一（重复 id 会让 MiniSearch 静默覆盖）', () => {
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length)
  })

  it('速查三兄弟带 (基准, 目标)，且归入**目标语言**的分片', () => {
    for (const d of docs) {
      if (d.type === 'pitfall' || d.type === 'glossary' || d.type === 'roadmap') {
        expect(d.baseline, d.id).toBeTruthy()
        expect(d.target, d.id).toBeTruthy()
        expect(d.section, d.id).toBeTruthy()
        // 「带着 A 的习惯写 B 会踩的坑」讲的是 B —— 用户在 /compare/<A>/pitfalls
        // 时可见列含 B，正好会加载到这份分片
        expect(d.lang, d.id).toBe(d.target)
      }
    }
  })

  it('按语言分片，且每个分片只装本语言的文档', () => {
    expect(Object.keys(payloads).sort()).toEqual([...analysis.enabledLanguageIds].sort())
    for (const [lang, payload] of Object.entries(payloads)) {
      const expected = docs.filter((d) => d.lang === lang).length
      expect(payload.docCount, `${lang} 分片文档数`).toBe(expected)
    }
  })

  it('分片只是切分，不是复制 —— 总量与不分片一致', () => {
    const total = Object.values(payloads).reduce((n, p) => n + p.docCount, 0)
    expect(total).toBe(docs.length)
  })

  it('对比框两套说明都进索引（差异解释是检索价值最高的部分）', () => {
    // Python 的每个框都写了 vs.javascript，那段文字必须可搜
    const py = payloads.python!
    const engine = loadSearchIndex(py.index)
    const hits = engine.search('赋值即声明') as unknown as Array<Record<string, unknown>>
    expect(hits.length).toBeGreaterThan(0)
  })
})
