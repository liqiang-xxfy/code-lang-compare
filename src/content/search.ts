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
   * 这条内容属于哪个**基准**。
   *
   * 内容按 (基准, 目标) 对拆成多套后，同一个概念会在 3 个基准下各有一条文档。
   * 查询时按当前基准过滤，否则搜「闭包」会返回三条几乎一样的结果。
   * 空字符串表示**所有基准共享**（心智模型对照表这类与基准无关的内容）。
   */
  baseline: string
  /** 所属板块，用于结果分组与将来的域内检索 */
  section?: Section
  /** 对级内容的另一侧 */
  target?: string
}

export const SEARCH_FIELDS = ['title', 'text'] as const
export const SEARCH_STORED_FIELDS = [
  'type',
  'title',
  'url',
  'meta',
  'baseline',
  'section',
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
export function queryOptions(baseline?: string): SearchOptions {
  return {
    tokenize: (text: string) => tokenizeQuery(text),
    boost: { title: 3 },
    prefix: true,
    combineWith: 'AND',
    fuzzy: false,
    /*
     * 按基准过滤 —— 三套内容全在索引里，但一个用户一次只在看一套。
     * 不过滤的话搜「闭包」会同时返回 js 基准与 python 基准下的同名条目。
     * 空 baseline 的文档是两个基准共享的（心智模型对照表），始终可见。
     */
    ...(baseline
      ? { filter: (r: Record<string, unknown>) => r.baseline === baseline || r.baseline === '' }
      : {}),
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
