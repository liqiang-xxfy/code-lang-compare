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

  it('四类内容都进了索引', () => {
    expect(docCount).toBeGreaterThan(0)
    // 心智模型自 ADR-31 起是「板块下的章节型内容」，走 feature 文档，不再是独立类型
    for (const type of ['feature', 'pitfall', 'glossary', 'roadmap']) {
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

  it('对级内容都带 (基准, 目标) —— 这是分片与查询过滤的依据', () => {
    const docs = buildSearchDocs(analyzeContent())
    for (const d of docs) {
      if (d.type === 'pitfall' || d.type === 'glossary' || d.type === 'roadmap') {
        expect(d.baseline, d.id).toBeTruthy()
        expect(d.target, d.id).toBeTruthy()
        expect(d.section, d.id).toBeTruthy()
      }
    }
  })

  it('心智模型按基准分片，不再是全局共享文档', () => {
    /*
     * 这条断言在 ADR-31 之前是反的：那时「心智模型」是与基准无关的一份全局内容，
     * 26 条概念建成 `baseline: ''` 的文档、三个分片都收，url 一律指向
     * `/lang/<默认基准>` —— 于是搜「包管理」只会落到同一张只读大表。
     *
     * 现在概念按基准视角分别撰写，是**板块下的章节型内容**，走 feature 文档
     * （带自己的 baseline 与 `/feature/concepts-<基准>/<slug>` 地址）。
     * 这里钉住的就是这件事：它们必须落在各自基准的分片里，而不是每片都收。
     */
    const analysis = analyzeContent()
    const docs = buildSearchDocs(analysis)
    const conceptDocs = docs.filter((d) => d.id.includes('concepts-'))
    expect(conceptDocs.length).toBeGreaterThan(0)
    for (const d of conceptDocs) {
      expect(d.type, d.id).toBe('feature')
      expect(d.baseline, d.id).toBeTruthy()
      expect(d.url.startsWith('/feature/'), d.id).toBe(true)
    }

    // 每个概念文档只出现在**它自己基准**的分片里（分片键 = topic 的基准）
    const payloads = buildSearchIndexPayloads(analysis, '2026-10-01T00:00:00.000Z')
    expect(Object.keys(payloads).sort()).toEqual(['java', 'javascript', 'python'])
    for (const [baseline, p] of Object.entries(payloads)) {
      const mine = conceptDocs.filter((d) => d.baseline === baseline).length
      expect(p.byType.feature, `${baseline} 分片`).toBeGreaterThanOrEqual(mine)
    }
  })

  it('每个分片只收本基准的文档', () => {
    const analysis = analyzeContent()
    const docs = buildSearchDocs(analysis)
    const payloads = buildSearchIndexPayloads(analysis, '2026-10-01T00:00:00.000Z')

    // 没有「与基准无关」的文档了（见上面那条断言）—— 每条文档恰属于一个基准，
    // 因此分片文档数就是该基准的文档数，不存在跨片共享的余量。
    expect(docs.every((d) => d.baseline !== '')).toBe(true)
    for (const [baseline, payload] of Object.entries(payloads)) {
      const expected = docs.filter((d) => d.baseline === baseline).length
      expect(payload.docCount, `${baseline} 分片文档数`).toBe(expected)
    }
    // 三套内容确实不同 —— 否则分片就只是徒增文件
    const pythonOnly = docs.filter((d) => d.baseline === 'python').length
    expect(pythonOnly).toBeGreaterThan(0)
    expect(payloads.javascript!.docCount).toBeGreaterThan(payloads.python!.docCount)
  })

  it('查询过滤生效：拿着 A 基准的选项查 B 基准的分片，什么都捞不到', () => {
    const analysis = analyzeContent()
    const docs = buildSearchDocs(analysis)
    const pythonOnly = docs.find(
      (d) => d.baseline === 'python' && d.type === 'glossary' && d.section === 'glossary',
    )
    expect(pythonOnly, '需要一条 python 基准独有的词典条目来验证过滤').toBeTruthy()

    const engine = loadSearchIndex(
      buildSearchIndexPayloads(analysis, '2026-10-01T00:00:00.000Z').python!.index,
    )
    const raw = engine.search(pythonOnly!.title) as unknown as Array<Record<string, unknown>>
    const filtered = engine.search(
      pythonOnly!.title,
      queryOptions('javascript'),
    ) as unknown as Array<Record<string, unknown>>

    // 不过滤时能命中（文档确实在索引里）；带上 javascript 的过滤条件后必须**一条都不剩** ——
    // 过滤是「只留 baseline 相等的」，而 python 分片里没有 javascript 基准的文档。
    // （曾经这里有 `|| baseline === ''` 的兜底，那些全局共享文档已随 ADR-31 消失。）
    expect(raw.length).toBeGreaterThan(0)
    expect(raw.some((r) => r.baseline === 'python')).toBe(true)
    expect(filtered.length).toBe(0)
  })
})
