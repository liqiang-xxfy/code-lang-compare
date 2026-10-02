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
  const nameOf = (id: string) => a.metaById[id]?.name ?? id

  /* ── 1. 对照特性 ── */
  for (const chapter of a.chapters) {
    const cfg = a.registry.topics[chapter.topicId]
    if (!cfg?.enabled) continue
    const context = `${cfg.title} ${chapter.title}`
    for (const feature of chapter.features) {
      const extra: string[] = []
      const bucket = a.snippets.get(feature.id)
      if (bucket) {
        for (const [lang, snippet] of bucket) {
          // @note 注记是内容里检索价值最高的部分
          // （「改内容会传染，改绑定不会」这类可背诵的结论就写在注记里）
          const commentLine = a.metaById[lang]?.comment.line
          if (commentLine && snippet.code) {
            // 用 allNotes 而非 notes：notes 只收高危项，会漏掉普通注记的文本，
            // 而两种语气的说明文本都是内容里检索价值最高的部分
            const { allNotes } = extractNotes(snippet.code, commentLine)
            for (const n of allNotes) extra.push(n.text)
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
        meta: cfg.target ? `${nameOf(cfg.baseline)} → ${nameOf(cfg.target)} · ${chapter.title}` : context,
        baseline: cfg.baseline,
        section: cfg.section,
        ...(cfg.target ? { target: cfg.target } : {}),
      })
    }
  }

  for (const pair of a.pairs) {
    const pairLabel = `${nameOf(pair.baseline)} → ${nameOf(pair.target)}`

    /* ── 2. 迁移陷阱（全站最高价值的内容，必须可搜） ── */
    for (const p of pair.pitfalls) {
      docs.push({
        id: `pitfall:${pair.baseline}:${pair.target}:${p.id}`,
        type: 'pitfall',
        title: p.title,
        text: [
          plain(p.symptom),
          plain(p.cause),
          plain(p.fix),
          p.tags.join(' '),
          p.languages.join(' '),
        ]
          .filter(Boolean)
          .join(' '),
        // pitfall.id 本身已带 `pitfall-` 前缀，直接用它做锚点，避免出现 `#pitfall-pitfall-xxx`
        // 目标语言不在地址里（P8 起由页内选择条决定），所以链到板块页即可 ——
        // 点进结果时视图会把 hit.target 并进选择，落在正确的方向上。
        url: `/compare/${pair.baseline}/pitfalls#${p.id}`,
        meta: `${pairLabel} · 严重度 ${'★'.repeat(p.severity)}`,
        baseline: pair.baseline,
        section: 'pitfalls',
        target: pair.target,
      })
    }

    /* ── 4. 速语词典（同名不同义 / 异名同义） ── */
    for (const t of pair.glossary) {
      docs.push({
        id: `glossary:${pair.baseline}:${pair.target}:${t.term}`,
        type: 'glossary',
        title: t.term,
        text: [t.aliases.join(' '), Object.values(t.perLanguage).join(' '), plain(t.note ?? '')]
          .filter(Boolean)
          .join(' '),
        url: `/compare/${pair.baseline}/glossary#term-${encodeURIComponent(t.term)}`,
        meta: t.aliases.length ? `${pairLabel} · 又称 ${t.aliases.join(' / ')}` : `${pairLabel} · 速语词典`,
        baseline: pair.baseline,
        section: 'glossary',
        target: pair.target,
      })
    }

    /* ── 5. 迁移学习路线阶段 ── */
    for (const stage of pair.roadmaps) {
      docs.push({
        id: `roadmap:${pair.baseline}:${pair.target}:${stage.id}`,
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
        url: `/compare/${pair.baseline}/roadmap`,
        meta: `${pairLabel} · 学习路线`,
        baseline: pair.baseline,
        section: 'roadmap',
        target: pair.target,
      })
    }
  }

  /*
   * 心智模型**没有**单独一支 —— 它已经是「心智模型」板块下的普通章节型内容，
   * 上面第 1 步的章节循环会为它的每条概念生成 feature 文档（带自己的
   * baseline 与 url `/feature/concepts-<基准>/<slug>`）。
   *
   * 这里曾经有一支特判，把 26 条概念建成 `type: 'concept'`、`baseline: ''` 的
   * 全局文档，url 一律指向 `/lang/<默认基准>` —— 那套模型假设「概念与基准无关」。
   * 概念改为按基准视角撰写之后（ADR-31），特判会与 feature 文档重复收录同一内容，
   * 且把所有结果都指向同一个页面。
   */

  return docs
}

export interface SearchIndexPayload {
  generatedAt: string
  baseline: string
  docCount: number
  byType: Record<SearchDocType, number>
  /** MiniSearch 序列化索引（字符串）—— 客户端 loadJSON 后直接可搜 */
  index: string
}

function payloadOf(docs: SearchDoc[], baseline: string, generatedAt: string): SearchIndexPayload {
  const mini = new MiniSearch<SearchDoc>(indexOptions())
  mini.addAll(docs)

  const byType = { feature: 0, pitfall: 0, glossary: 0, roadmap: 0 } as Record<
    SearchDocType,
    number
  >
  for (const d of docs) byType[d.type] += 1

  return {
    generatedAt,
    baseline,
    docCount: docs.length,
    byType,
    // 序列化成字符串再落盘：客户端 loadJSON 直接消费，不必先 JSON.parse 一层
    index: JSON.stringify(mini.toJSON()),
  }
}

/**
 * 按基准分片。**为什么不分片不行**：内容按 (基准, 目标) 对拆成三套后，
 * 单个索引会涨到三倍（现状已 104 KB(gz)，超 90 KB 红线），而用户一次只看一套。
 * 分片把「一次下载量」压回与分片前同级，同时让查询侧不必再过滤掉三分之二的结果。
 *
 * 取舍：3 个分片文件而不是 1 个，且客户端必须用 `import.meta.glob`（不能拼字符串动态 import）。
 */
export function buildSearchIndexPayloads(
  a: Analysis,
  generatedAt: string,
): Record<string, SearchIndexPayload> {
  const docs = buildSearchDocs(a)
  const baselines = new Set(a.metas.filter((m) => m.baseline).map((m) => m.id))
  baselines.add(a.registry.defaultBaseline)

  const out: Record<string, SearchIndexPayload> = {}
  for (const baseline of [...baselines].sort()) {
    out[baseline] = payloadOf(
      docs.filter((d) => d.baseline === baseline || d.baseline === ''),
      baseline,
      generatedAt,
    )
  }
  return out
}
