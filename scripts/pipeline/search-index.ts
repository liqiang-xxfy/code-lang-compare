/**
 * 构建期生成搜索索引。
 *
 * 为什么在构建期而不是客户端：
 *  · 索引与内容天然同源 —— 不会出现「内容更新了但索引还是旧的」
 *  · 客户端拿到 `loadJSON` 即可检索，零建索引开销（首次进搜索页也不卡）
 *  · 中文分词需要跑 bigram，放在构建期做一次，比在每个用户浏览器里做更划算
 *
 * v2 改成**按语言分片**：内容本来就按语言组织，一门语言的文字只索引一次
 * （全站总量 ≈ 1×）。旧架构按基准分片，同一段文字要在 3 个分片里各存一份。
 */
import MiniSearch from 'minisearch'
import type { Analysis } from '../lib/analyze'
import { extractNotes } from '../lib/core'
import { indexOptions, type SearchDoc, type SearchDocType } from '../../src/content/search'
import type { Section } from '../../src/schemas'

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

  /* ── 1. 对比框（每个 feature × 每门写了它的语言一条） ── */
  for (const f of a.features) {
    const bucket = a.boxes.get(f.id)
    if (!bucket) continue
    /*
     * 上下文用「板块 + 存放组」，**不用章节标题** —— 章节名随基准变（每个基准一套章节分类），
     * 把某一份写进索引就等于对另外两个基准说谎。存放组与基准无关，对所有基准都成立。
     */
    const context = `${a.registry.sections[f.section]?.title ?? f.section} ${f.group}`

    for (const [lang, box] of bucket) {
      const commentLine = a.metaById[lang]?.comment.line
      const extra: string[] = []
      if (commentLine) {
        const raw = box.blocks?.length ? box.blocks.map((b) => b.code).join('\n') : box.code
        if (raw.trim()) {
          // 用 allNotes 而非 notes：notes 只收高危项，会漏掉普通注记的文本，
          // 而两种语气的说明文本都是内容里检索价值最高的部分
          for (const n of extractNotes(raw, commentLine).allNotes) extra.push(n.text)
        }
      }
      /*
       * 第 ③ 槽**两套都进索引**：一个分片只装一门语言的文字，所以这里不会重复；
       * 漏掉 vs 那一半就等于把「差异解释」——内容里最该被搜到的部分——排除掉了。
       */
      if (box.baseline) extra.push(plain(box.baseline))
      for (const text of Object.values(box.vs)) if (text.trim()) extra.push(plain(text))

      docs.push({
        id: `feature:${lang}:${f.id}`,
        type: 'feature',
        title: f.feature.title,
        text: [
          f.feature.summary ?? '',
          extra.join(' '),
          context,
          // 语言名进正文，这样「python 作用域」这类带语言的查询能命中
          nameOf(lang),
          lang,
          f.feature.tags.join(' '),
        ]
          .filter(Boolean)
          .join(' '),
        url: `/feature/${f.id}`,
        meta: `${nameOf(lang)} · ${context}`,
        lang,
        section: f.section as Section,
      })
    }
  }

  /* ── 2. 速查三兄弟（方向性内容，归入**目标语言**的分片） ── */
  /*
   * 为什么归目标语言：「带着 JS 习惯写 Python 会踩的坑」讲的是 Python。
   * 用户在 `/compare/javascript/pitfalls` 时可见列含 Python（基准 + 目标），
   * 正好会加载到这份分片。
   */
  for (const pair of a.pairs) {
    const pairLabel = `${nameOf(pair.baseline)} → ${nameOf(pair.target)}`
    const lang = pair.target

    for (const p of pair.pitfalls) {
      docs.push({
        id: `pitfall:${pair.baseline}:${pair.target}:${p.id}`,
        type: 'pitfall',
        title: p.title,
        text: [plain(p.symptom), plain(p.cause), plain(p.fix), p.tags.join(' '), p.languages.join(' ')]
          .filter(Boolean)
          .join(' '),
        // pitfall.id 本身已带 `pitfall-` 前缀，直接用它做锚点
        url: `/compare/${pair.baseline}/pitfalls#${p.id}`,
        meta: `${pairLabel} · 严重度 ${'★'.repeat(p.severity)}`,
        lang,
        section: 'pitfalls',
        baseline: pair.baseline,
        target: pair.target,
      })
    }

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
        lang,
        section: 'glossary',
        baseline: pair.baseline,
        target: pair.target,
      })
    }

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
        lang,
        section: 'roadmap',
        baseline: pair.baseline,
        target: pair.target,
      })
    }
  }

  return docs
}

export interface SearchIndexPayload {
  generatedAt: string
  /** 分片键 = 语言 id */
  lang: string
  docCount: number
  byType: Record<SearchDocType, number>
  /** MiniSearch 序列化索引（字符串）—— 客户端 loadJSON 后直接可搜 */
  index: string
}

function payloadOf(docs: SearchDoc[], lang: string, generatedAt: string): SearchIndexPayload {
  const mini = new MiniSearch<SearchDoc>(indexOptions())
  mini.addAll(docs)

  const byType = { feature: 0, pitfall: 0, glossary: 0, roadmap: 0 } as Record<SearchDocType, number>
  for (const d of docs) byType[d.type] += 1

  return {
    generatedAt,
    lang,
    docCount: docs.length,
    byType,
    // 序列化成字符串再落盘：客户端 loadJSON 直接消费，不必先 JSON.parse 一层
    index: JSON.stringify(mini.toJSON()),
  }
}

/**
 * 按语言分片。客户端只加载**当前可见列**对应的那几份（基准 + 勾选的对比语言），
 * 于是搜索结果天然与屏幕上能看到的列一致，不需要查询侧再过滤。
 *
 * 取舍：分片数从 3 涨到「启用语言数」，但每片只装一门语言的文字，总量 ≈ 1×。
 */
export function buildSearchIndexPayloads(
  a: Analysis,
  generatedAt: string,
): Record<string, SearchIndexPayload> {
  const docs = buildSearchDocs(a)
  const out: Record<string, SearchIndexPayload> = {}
  for (const lang of a.enabledLanguageIds) {
    out[lang] = payloadOf(
      docs.filter((d) => d.lang === lang),
      lang,
      generatedAt,
    )
  }
  return out
}
