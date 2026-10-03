/**
 * 搜索 —— **构建期建索引与客户端查询共用这里的配置**。
 *
 * 为什么必须共用：
 *  · tokenize 若两边不一致，索引建得出来、查询也跑得动，就是命中率莫名偏低 —— 静默失败，极难查
 *  · MiniSearch 的 `toJSON()` **不序列化 options**，所以 loadJSON 时必须把字段/分词配置再给一遍。
 *    把这些选项集中在这里，就不会出现「构建期配了一套、客户端凭记忆又写一套」。
 */
import MiniSearch, { type Options, type SearchOptions } from 'minisearch'
import type { Section } from '@/schemas'
import { tokenize, tokenizeQuery } from './search-tokenize'

export type SearchDocType = 'feature' | 'pitfall' | 'glossary' | 'roadmap'

/** 索引里的一条文档。字段刻意扁平 —— 便于 MiniSearch 直接消费，也便于体积控制 */
export interface SearchDoc {
  id: string
  type: SearchDocType
  title: string
  /** 参与检索但不展示的正文（含章节名、语言名、注记等上下文词） */
  text: string
  url: string
  /** 结果行右侧的上下文标签：章节名 / 严重度 / 词条类别 */
  meta: string
  /**
   * 这条文档住在**哪个语言的分片**里。
   *
   * v2 的内容按语言组织，索引也跟着按语言分片（全站总量 ≈ 1×，而按基准分片
   * 会把同一段文字存三份）。客户端只加载当前可见列对应的分片，
   * 于是搜索结果天然与屏幕上能看到的列一致，查询侧不必再过滤。
   *
   * 速查三兄弟归入**目标语言**的分片 ——「带着 A 习惯写 B 会踩的坑」讲的是 B。
   */
  lang: string
  /** 所属板块，用于结果分组与将来的域内检索 */
  section?: Section
  /** 方向性内容（速查三兄弟）才有：它讲的是哪两门语言 */
  baseline?: string
  target?: string
}

export const SEARCH_FIELDS = ['title', 'text'] as const
export const SEARCH_STORED_FIELDS = [
  'type',
  'title',
  'url',
  'meta',
  'lang',
  'section',
  'baseline',
  'target',
] as const

/** 建索引选项（构建期） */
export function indexOptions(): Options<SearchDoc> {
  return {
    idField: 'id',
    fields: [...SEARCH_FIELDS],
    storeFields: [...SEARCH_STORED_FIELDS],
    tokenize: (text: string) => tokenize(text),
  }
}

/**
 * 查询选项。
 *
 * `combineWith: 'AND'` 是刻意的：中文 bigram 会让「数组」产生 数/组/数组 三个 token，
 * 若用默认的 OR，搜「数组」会把所有含「数」的条目都捞出来（函数、数值…）。
 * AND 之下这些 token 必须同时出现，召回才准。
 *
 * `prefix: true` 用于代码符号的渐进输入（toFix → toFixed）。
 * `fuzzy` 保持关闭：中文 bigram 场景下模糊匹配只会引入噪音，而代码标识符本就要求精确。
 */
export function queryOptions(): SearchOptions {
  return {
    tokenize: (text: string) => tokenizeQuery(text),
    boost: { title: 3 },
    prefix: true,
    combineWith: 'AND',
    fuzzy: false,
    /*
     * 刻意**没有** filter：一个分片只装一门语言的文字，客户端按可见列挑分片加载，
     * 所以「搜到的」与「屏幕上能看到的列」天然一致，不需要查询侧再筛一遍。
     */
  }
}

/** 客户端装载：从序列化索引还原实例（字段与分词配置必须与构建期一致） */
export function loadSearchIndex(json: string): MiniSearch<SearchDoc> {
  return MiniSearch.loadJSON<SearchDoc>(json, {
    ...indexOptions(),
    searchOptions: queryOptions(),
  })
}

export interface SearchHit {
  id: string
  score: number
  type: SearchDocType
  title: string
  url: string
  meta: string
  section?: Section
  target?: string
}

/** 把 MiniSearch 的原始结果收敛成视图层要的形状（不泄漏库类型） */
export function toHits(results: Array<Record<string, unknown>>): SearchHit[] {
  return results.map((r) => ({
    id: String(r.id),
    score: Number(r.score ?? 0),
    type: r.type as SearchDocType,
    title: String(r.title ?? ''),
    url: String(r.url ?? '/'),
    meta: String(r.meta ?? ''),
    ...(r.section ? { section: r.section as Section } : {}),
    ...(r.target ? { target: String(r.target) } : {}),
  }))
}
