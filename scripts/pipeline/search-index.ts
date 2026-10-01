/**
 * 构建期生成搜索索引（架构定稿 §8.3 预留的 `search-index` 生成钩子）。
 *
 * 为什么在构建期而不是客户端：
 *  · 索引与内容天然同源 —— 不会出现「内容更新了但索引还是旧的」
 *  · 客户端拿到 `loadJSON` 即可检索，零建索引开销（首次进搜索页也不卡）
 *  · 中文分词需要跑 bigram，放在构建期做一次，比在每个用户浏览器里做更划算
 */
import MiniSearch from 'minisearch'
import type { Analysis } from '../lib/analyze'
import { extractNotes } from '../lib/core'
import { indexOptions, type SearchDoc, type SearchDocType } from '../../src/content/search'

/**
 * 把 Markdown 粗剥成纯文本。
 * 只为了不让 `` ` `` `**` 之类的标记混进索引（它们会被 tokenize 当成符号 token），
 * 不需要精确 —— 索引用的正文本来就不展示。
 */
function plain(input: string): string {
  return input
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[>#\-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildSearchDocs(a: Analysis): SearchDoc[] {
  const docs: SearchDoc[] = []
  const topicTitle = (topicId: string) => a.registry.topics[topicId]?.title ?? topicId

  /* ── 1. 对照特性（72 条，主检索面） ── */
  for (const chapter of a.chapters) {
    if (!a.registry.topics[chapter.topicId]?.enabled) continue
    const context = `${topicTitle(chapter.topicId)} ${chapter.title}`
    for (const feature of chapter.features) {
      const extra: string[] = []
      const bucket = a.snippets.get(feature.id)
      if (bucket) {
        for (const [lang, snippet] of bucket) {
          // @note 注记是内容里检索价值最高的部分
          // （「改内容会传染，改绑定不会」这类可背诵的结论就写在注记里）
          const commentLine = a.metaById[lang]?.comment.line
          if (commentLine && snippet.code) {
            const { notes } = extractNotes(snippet.code, commentLine)
            for (const n of notes) extra.push(n.text)
          }
          if (snippet.body) extra.push(plain(snippet.body))
        }
      }
      docs.push({
        id: `feature:${feature.id}`,
        type: 'feature',
        title: feature.title,
        text: [
          feature.summary ?? '',
          plain(feature.body ?? ''),
          extra.join(' '),
          context,
          // 语言名进正文，这样「python 数组」这类带语言的查询能命中所有相关条目
          a.enabledLanguageIds.join(' '),
          feature.tags.join(' '),
        ]
          .filter(Boolean)
          .join(' '),
        url: `/feature/${feature.id}`,
        meta: context,
      })
    }
  }

  /* ── 2. 迁移陷阱（全站最高价值的内容，必须可搜） ── */
  for (const p of a.pitfalls) {
    docs.push({
      id: `pitfall:${p.id}`,
      type: 'pitfall',
      title: p.title,
      text: [plain(p.symptom), plain(p.cause), plain(p.fix), p.tags.join(' '), p.languages.join(' ')]
        .filter(Boolean)
        .join(' '),
      // pitfall.id 本身已带 `pitfall-` 前缀，直接用它做锚点，避免出现 `#pitfall-pitfall-xxx`
      url: `/pitfalls#${p.id}`,
      meta: `严重度 ${'★'.repeat(p.severity)}`,
    })
  }

  /* ── 3. 心智模型对照 ── */
  for (const c of a.concepts) {
    const entries = Object.entries(c.entries)
    docs.push({
      id: `concept:${c.id}`,
      type: 'concept',
      title: c.concept,
      text: entries
        .flatMap(([lang, e]) => [e.label, plain(e.detail), a.metaById[lang]?.name ?? lang])
        .join(' '),
      // 概念对照表渲染在语言入口页；指向基准语言最稳（不依赖某门语言是否已写内容）
      url: `/lang/${a.registry.baseline}`,
      meta: '心智模型对照',
    })
  }

  /* ── 4. 术语词典（同名不同义 / 异名同义） ── */
  for (const t of a.glossary) {
    docs.push({
      id: `glossary:${t.term}`,
      type: 'glossary',
      title: t.term,
      text: [t.aliases.join(' '), Object.values(t.perLanguage).join(' '), plain(t.note ?? '')]
        .filter(Boolean)
        .join(' '),
      url: `/glossary#term-${encodeURIComponent(t.term)}`,
      meta: t.aliases.length ? `又称 ${t.aliases.join(' / ')}` : '术语词典',
    })
  }

  /* ── 5. 学习路线阶段 ── */
  for (const [langId, stages] of Object.entries(a.roadmaps)) {
    if (!a.enabledLanguageIds.includes(langId)) continue
    const langName = a.metaById[langId]?.name ?? langId
    for (const stage of stages) {
      docs.push({
        id: `roadmap:${langId}:${stage.id}`,
        type: 'roadmap',
        title: stage.title,
        text: [
          stage.durationHint ?? '',
          stage.todo.join(' '),
          stage.acceptance.join(' '),
          stage.resources.map((r) => r.label).join(' '),
        ]
          .filter(Boolean)
          .join(' '),
        url: `/roadmap/${langId}`,
        meta: `${langName} 学习路线`,
      })
    }
  }

  return docs
}

export interface SearchIndexPayload {
  generatedAt: string
  docCount: number
  byType: Record<SearchDocType, number>
  /** MiniSearch 序列化索引（字符串）—— 客户端 loadJSON 后直接可搜 */
  index: string
}

export function buildSearchIndexPayload(a: Analysis, generatedAt: string): SearchIndexPayload {
  const docs = buildSearchDocs(a)

  const mini = new MiniSearch<SearchDoc>(indexOptions())
  mini.addAll(docs)

  const byType = { feature: 0, pitfall: 0, concept: 0, glossary: 0, roadmap: 0 } as Record<
    SearchDocType,
    number
  >
  for (const d of docs) byType[d.type] += 1

  return {
    generatedAt,
    docCount: docs.length,
    byType,
    // 序列化成字符串再落盘：客户端 loadJSON 直接消费，不必先 JSON.parse 一层
    index: JSON.stringify(mini.toJSON()),
  }
}
