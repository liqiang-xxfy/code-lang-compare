/**
 * 搜索的可执行契约。
 *
 * 重点是**中文检索**：MiniSearch 基于空格分词，中文没有空格，直接用会静默失效
 * （不报错、索引也建得出来，就是搜不到）。这里的断言就是钉住这一点。
 * 另外钉住「构建期与客户端同源」——两边 tokenize 分叉是同一个静默失败。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeContent } from '../../scripts/lib/analyze'
import { buildSearchDocs, buildSearchIndexPayload } from '../../scripts/pipeline/search-index'
import { loadSearchIndex, toHits, type SearchHit } from '../../src/content/search'
import { tokenize, tokenizeQuery } from '../../src/content/search-tokenize'

let search: (q: string) => SearchHit[]
let docCount = 0
let byType: Record<string, number> = {}

beforeAll(() => {
  const analysis = analyzeContent()
  const payload = buildSearchIndexPayload(analysis, '2026-10-01T00:00:00.000Z')
  const engine = loadSearchIndex(payload.index)
  search = (q: string) => toHits(engine.search(q) as Array<Record<string, unknown>>)
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

describe('检索', () => {
  it('中文词能命中（这是默认分词会失败的场景）', () => {
    const hits = search('数组')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('长中文词命中高相关条目', () => {
    const hits = search('可变默认参数')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.title.includes('默认参数'))).toBe(true)
  })

  it('代码符号可检索', () => {
    const hits = search('toFixed')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('「语言名 + 关键词」组合有效', () => {
    expect(search('python 数组').length).toBeGreaterThan(0)
  })

  it('AND 语义：多词必须同时命中，不会退化成 OR 的泛召回', () => {
    const broad = search('数组').length
    const narrow = search('数组 switch').length
    expect(broad).toBeGreaterThan(0)
    expect(narrow).toBeLessThan(broad)
  })

  it('无关查询返回空（不硬凑结果）', () => {
    // 用纯拉丁乱码：含汉字的话会被切成 bigram，可能意外命中真实词组
    expect(search('zzzqxyz')).toHaveLength(0)
  })

  it('五类内容都进了索引', () => {
    expect(docCount).toBeGreaterThan(0)
    for (const type of ['feature', 'pitfall', 'concept', 'glossary', 'roadmap']) {
      expect(byType[type]).toBeGreaterThan(0)
    }
  })

  it('结果带可跳转的 url（不能只给标题）', () => {
    for (const hit of search('数组').slice(0, 5)) {
      expect(hit.url.startsWith('/')).toBe(true)
      expect(hit.title.length).toBeGreaterThan(0)
    }
  })
})

describe('文档构造', () => {
  it('每条文档 text 都含语言名，使「语言 + 关键词」可召回', () => {
    const analysis = analyzeContent()
    const docs = buildSearchDocs(analysis)
    const features = docs.filter((d) => d.type === 'feature')
    expect(features.length).toBeGreaterThan(0)
    for (const d of features.slice(0, 10)) {
      expect(d.text).toContain('javascript')
    }
  })

  it('文档 id 全局唯一（重复 id 会让 MiniSearch 静默覆盖）', () => {
    const docs = buildSearchDocs(analyzeContent())
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length)
  })
})
