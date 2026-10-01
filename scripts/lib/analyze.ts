/**
 * 内容分析与校验 —— validate 与 build 共用同一份装载/合并/检查逻辑。
 *
 * 为什么要共用：如果校验用一套装载、构建用另一套，「校验通过但构建出问题」
 * 就是必然结果。这里保证两者看到的内容完全一致。
 */
import path from 'node:path'
import type {
  AttributionEntry,
  Chapter,
  ConceptGroup,
  Feature,
  GlossaryTerm,
  Issue,
  LanguageMeta,
  Pitfall,
  Registry,
  RoadmapStage,
  SnippetSource,
} from '../../src/schemas'
import {
  extractNotes,
  isSafeUrl,
  listLanguageIds,
  loadAllLanguageMeta,
  loadChapters,
  loadConcepts,
  loadGlossary,
  loadPitfalls,
  loadRegistry,
  loadRoadmap,
  loadSnippets,
  ROOT,
} from './core'

/* ────────────────────────── 许可台账 ────────────────────────── */

/**
 * 许可台账：把「合规」从口头约定变成可检查资产。
 *
 * 台账只登记**实际被使用**的来源 —— 登记了却没内容使用只会制造噪音，
 * 而真正要防的是反过来的情况：有内容使用却没登记义务（见下面 R3 的检查）。
 *
 * 每条必须回答三个问题：这个许可要求我做什么？我在哪履行了？用在哪？
 */
const LEDGER_TEMPLATE: Record<string, Omit<AttributionEntry, 'usedBy' | 'sourceId'>> = {
  thealgorithms: {
    url: 'https://github.com/TheAlgorithms',
    license: 'MIT',
    obligation: '保留版权声明与许可文本',
    fulfilledAt: ['/attributions#thealgorithms', '页脚全局声明'],
  },
  rosettacode: {
    url: 'https://rosettacode.org/',
    license: 'GFDL-1.2',
    obligation: '不得逐字复制；必须改写 + 逐条署名 + 独立署名页 + 页脚 GFDL 声明',
    fulfilledAt: ['/attributions#rosettacode'],
  },
  manual: {
    license: 'CC-BY-4.0',
    obligation: '本工具原创内容，署名本站即可',
    fulfilledAt: ['/attributions#manual'],
  },
}

/**
 * `llm` 产出不产生可署名许可，因此**刻意不进台账**（ADR-08）。
 * 它的合规责任由「人工审阅记录 + 页面上的未校对标记」承担。
 */
const NON_LEDGER_ORIGINS = new Set(['llm'])

/* ────────────────────────── 分析结果 ────────────────────────── */

export interface SnippetRef {
  featureId: string
  lang: string
  raw: SnippetSource
}

export interface Analysis {
  registry: Registry
  metas: LanguageMeta[]
  allLanguageIds: string[]
  enabledLanguageIds: string[]
  metaById: Record<string, LanguageMeta>
  chapters: Chapter[]
  features: Array<{ feature: Feature; chapter: Chapter }>
  snippets: Map<string, Map<string, SnippetSource>> // featureId -> lang -> snippet
  pitfalls: Pitfall[]
  concepts: ConceptGroup[]
  glossary: GlossaryTerm[]
  roadmaps: Record<string, RoadmapStage[]>
  attributions: AttributionEntry[]
  issues: Issue[]
  stats: {
    featureCount: number
    snippetCount: number
    byState: Record<string, number>
    byOrigin: Record<string, number>
    coverage: Record<string, { have: number; total: number }>
  }
}

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/')

export function analyzeContent(): Analysis {
  const issues: Issue[] = []
  const err = (rule: string, where: string, message: string) =>
    issues.push({ rule, level: 'error', where, message })
  const warn = (rule: string, where: string, message: string) =>
    issues.push({ rule, level: 'warn', where, message })

  /* R1 结构合法性 —— loader 内部用 Zod 校验，失败即抛 */
  const registry = loadRegistry()
  const metas = loadAllLanguageMeta()
  const allLanguageIds = metas.map((m) => m.id)
  const metaById = Object.fromEntries(metas.map((m) => [m.id, m]))

  // R8 命名与一致性
  const dirIds = listLanguageIds()
  for (const id of dirIds) {
    if (metaById[id]?.id !== id) {
      err('R8', `content/languages/${id}/meta.yaml`, `meta.id = '${metaById[id]?.id}' 与目录名不一致`)
    }
    if (!(id in registry.languages)) {
      err('R8', `content/languages/${id}`, '有 meta.yaml 但未在 content/registry.yaml 注册')
    }
  }
  for (const id of Object.keys(registry.languages)) {
    if (!dirIds.includes(id)) {
      err('R8', 'content/registry.yaml', `登记了 '${id}' 但找不到对应语言目录`)
    }
  }

  const enabledLanguageIds = allLanguageIds.filter((id) => registry.languages[id]?.enabled)
  if (!enabledLanguageIds.includes(registry.baseline)) {
    err('R8', 'content/registry.yaml', `baseline = '${registry.baseline}' 必须是已启用的语言`)
  }
  const baselineCount = metas.filter((m) => m.baseline).length
  if (baselineCount !== 1) {
    err('R8', 'content/languages/*/meta.yaml', `标了 baseline: true 的语言有 ${baselineCount} 门，必须恰好 1 门`)
  }

  /* 章节与 Feature */
  const chapters = loadChapters()
  const featureIds = new Set<string>()
  const features: Analysis['features'] = []
  for (const chapter of chapters) {
    if (chapter.topicId !== chapter.id.split('/')[0]) {
      err('R8', `content/topics/${chapter.topicId}`, `章节 id '${chapter.id}' 的前缀应等于 topicId '${chapter.topicId}'`)
    }
    for (const feature of chapter.features) {
      if (featureIds.has(feature.id)) {
        err('R8', 'content/topics', `featureId 重复：${feature.id}`)
      }
      featureIds.add(feature.id)
      features.push({ feature, chapter })
    }
  }

  /* R5 引用完整性 */
  const snippets = new Map<string, Map<string, SnippetSource>>()
  const allSnippetFiles: Array<{ lang: string; file: string; items: SnippetSource[] }> = []
  for (const lang of dirIds) {
    allSnippetFiles.push({
      lang,
      file: rel(path.join(ROOT, 'content', 'languages', lang, 'snippets.yaml')),
      items: loadSnippets(lang),
    })
  }
  for (const { lang, file, items } of allSnippetFiles) {
    for (const s of items) {
      if (!featureIds.has(s.featureId)) {
        err('R5', file, `孤儿 snippet：featureId '${s.featureId}' 在 topics 里不存在`)
        continue
      }
      if (!allLanguageIds.includes(lang)) {
        err('R5', file, `语言 '${lang}' 不在语言目录列表中`)
      }
      const bucket = snippets.get(s.featureId) ?? new Map<string, SnippetSource>()
      if (bucket.has(lang)) {
        err('R8', file, `featureId '${s.featureId}' 在 '${lang}' 下重复定义`)
      }
      bucket.set(lang, s)
      snippets.set(s.featureId, bucket)
    }
  }

  /* R2 覆盖率：已启用语言不能有空洞 */
  const coverage: Record<string, { have: number; total: number }> = {}
  for (const lang of enabledLanguageIds) coverage[lang] = { have: 0, total: features.length }
  /**
   * 未启用语言已写好的实现数，按语言累计。
   *
   * 为什么汇总而不是逐条 warn：R2 允许「先攒内容后启用」，而攒内容阶段动辄上百条 ——
   * 逐条提示会把整个校验报告淹没，真正需要看的 error 反而找不到了。
   */
  const pendingByLang = new Map<string, number>()

  for (const { feature } of features) {
    const bucket = snippets.get(feature.id)
    for (const lang of enabledLanguageIds) {
      const s = bucket?.get(lang)
      if (!s) {
        err(
          'R2',
          feature.id,
          `缺少 '${lang}' 的实现。"还没写"和"语言里没有这个概念"必须区分开：确实没有请显式写 equivalence: absent + body 说明替代做法`,
        )
        continue
      }
      coverage[lang]!.have += 1
      if (s.equivalence === 'absent' && !s.body?.trim()) {
        warn('R2', `${feature.id} · ${lang}`, 'equivalence 为 absent，但没有用 body 说明替代做法')
      }
      if (s.equivalence === 'absent' && s.code.trim()) {
        warn('R2', `${feature.id} · ${lang}`, 'equivalence 为 absent 但提供了代码，请确认这是「惯用替代写法」而非等价实现')
      }
      if (!s.code.trim() && s.equivalence !== 'absent') {
        err('R2', `${feature.id} · ${lang}`, `equivalence 为 '${s.equivalence}' 但代码为空`)
      }
    }
    // 未启用语言有内容 → 只累计，不算问题（支持「先攒内容后启用」）
    for (const [lang] of bucket ?? []) {
      if (!enabledLanguageIds.includes(lang)) {
        pendingByLang.set(lang, (pendingByLang.get(lang) ?? 0) + 1)
      }
    }
  }

  for (const [lang, count] of [...pendingByLang].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R2',
      `content/languages/${lang}`,
      `${count} 条实现已写好，但 '${lang}' 尚未启用 —— 不会渲染（允许：先攒内容后启用）`,
    )
  }

  /* R4 / R9 内联 @note 标记 */
  /** draft 数量按语言累计：宽松策略下只汇总提示一次，避免几百条逐条刷屏 */
  const draftByLang = new Map<string, number>()

  for (const { feature } of features) {
    const bucket = snippets.get(feature.id) ?? new Map<string, SnippetSource>()
    for (const [lang, s] of bucket) {
      const meta = metaById[lang]
      if (!meta) continue
      const where = `${feature.id} · ${lang}`
      const markers = (s.code.match(/@note!?\s+/g) ?? []).length
      const { code, notes } = extractNotes(s.code, meta.comment.line)
      if (markers !== notes.length) {
        err(
          'R4/R9',
          where,
          `检测到 ${markers} 个 @note 标记，但只解析出 ${notes.length} 个。标记必须紧跟在 '${meta.comment.line}' 之后（该语言的注释前缀）`,
        )
      }
      if (code.includes('@note')) {
        err('R4', where, '剥离后仍残留 "@note" 文本，请检查标记写法')
      }
      for (const n of notes) {
        if (!n.text) warn('R4', `${where} 第 ${n.line} 行`, '@note 说明为空')
      }
    }
  }

  /* R3 provenance 与真实台账 */
  const usedBySource: Record<string, string[]> = {}
  const byOrigin: Record<string, number> = {}
  const byState: Record<string, number> = {}
  let snippetCount = 0
  for (const { feature } of features) {
    const bucket = snippets.get(feature.id) ?? new Map<string, SnippetSource>()
    for (const [lang, s] of bucket) {
      if (!enabledLanguageIds.includes(lang)) continue
      snippetCount += 1
      const where = `${feature.id} · ${lang}`
      const p = s.review.provenance
      byOrigin[p.origin] = (byOrigin[p.origin] ?? 0) + 1
      byState[s.review.state] = (byState[s.review.state] ?? 0) + 1

      usedBySource[p.origin] ??= []
      usedBySource[p.origin]!.push(where)

      // R7 协议白名单（真实存在的 url 必须 https）
      if ('url' in p && p.url && !isSafeUrl(p.url)) {
        err('R7', where, `provenance.url 不是 https：${p.url}`)
      }
      if (p.origin === 'thealgorithms' && !p.retrievedAt) {
        err('R3', where, 'thealgorithms 来源必须记录 retrievedAt')
      }
      if (p.origin === 'llm' && (!p.model || !p.promptTemplateId)) {
        err('R3', where, 'llm 来源必须记录 model 与 promptTemplateId')
      }

      // R6 发布门槛
      if (s.review.state === 'draft') {
        draftByLang.set(lang, (draftByLang.get(lang) ?? 0) + 1)
        if (registry.publishPolicy === 'reviewed-only') {
          err('R6', where, 'publishPolicy 为 reviewed-only，draft 不允许进入生产构建')
        }
      }
      if (s.review.state !== 'draft' && !s.review.reviewedBy) {
        warn('R3', where, `state 为 '${s.review.state}' 但未记录 reviewedBy`)
      }
    }
  }

  /*
   * 宽松策略下也得让人知道「有多少未校对内容正在进入构建」——
   * 否则 draft 会静静地发布出去，而「未校对」这件事只在页面上看得到、在构建日志里看不到。
   */
  if (draftByLang.size > 0 && registry.publishPolicy === 'include-draft-with-badge') {
    const total = [...draftByLang.values()].reduce((a, b) => a + b, 0)
    const detail = [...draftByLang]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([l, n]) => `${l} ${n}`)
      .join(' / ')
    warn(
      'R6',
      'content/',
      `当前 ${total} 条 draft 会进入构建（${detail}）—— 页面上会显示「未经人工校对」标记`,
    )
  }

  /* 台账只登记实际使用的来源；反过来，使用了却没登记义务的会被 R3 拦住 */
  const attributions: AttributionEntry[] = []
  for (const origin of Object.keys(usedBySource).sort()) {
    if (NON_LEDGER_ORIGINS.has(origin)) continue
    const template = LEDGER_TEMPLATE[origin]
    if (!template) {
      err('R3', origin, `来源 '${origin}' 有内容使用，但没有在许可台账模板里登记义务与履行位置`)
      continue
    }
    attributions.push({
      sourceId: origin,
      ...template,
      usedBy: [...new Set(usedBySource[origin] ?? [])].sort(),
    })
  }
  for (const e of attributions) {
    if (!e.fulfilledAt.length) {
      err('R10', `/attributions#${e.sourceId}`, `'${e.sourceId}' 的许可义务没有登记履行位置`)
    }
    for (const where of e.fulfilledAt) {
      if (!where.startsWith('/') && !where.includes('页脚')) {
        warn('R10', `/attributions#${e.sourceId}`, `履行位置 '${where}' 不像一个可核对的落点`)
      }
    }
  }

  /* 踩坑 / 心智模型 / 术语 / 路线图 */
  const pitfalls = loadPitfalls()
  for (const p of pitfalls) {
    if (p.featureId && !featureIds.has(p.featureId)) {
      err('R5', `content/topics/pitfalls/pitfalls.yaml#${p.id}`, `featureId '${p.featureId}' 不存在`)
    }
    for (const lang of p.languages) {
      if (!allLanguageIds.includes(lang)) {
        err('R5', `content/topics/pitfalls/pitfalls.yaml#${p.id}`, `语言 '${lang}' 不存在`)
      }
    }
  }
  const concepts = loadConcepts()
  for (const c of concepts) {
    if (!Object.keys(c.entries).length) err('R1', `concept ${c.id}`, 'entries 为空')
    for (const lang of Object.keys(c.entries)) {
      if (!allLanguageIds.includes(lang)) {
        err('R5', `concept ${c.id}`, `entries 引用了不存在的语言 '${lang}'`)
      }
    }
  }
  const glossary = loadGlossary()
  for (const g of glossary) {
    for (const lang of Object.keys(g.perLanguage)) {
      if (!allLanguageIds.includes(lang)) {
        err('R5', `glossary ${g.term}`, `perLanguage 引用了不存在的语言 '${lang}'`)
      }
    }
  }

  const roadmaps: Record<string, RoadmapStage[]> = {}
  for (const lang of allLanguageIds) {
    const stages = loadRoadmap(lang)
    if (stages.length) roadmaps[lang] = stages
    for (const s of stages) {
      if (s.lang !== lang) err('R8', `roadmap ${s.id}`, `lang 字段为 '${s.lang}'，与所在语言 '${lang}' 不符`)
      for (const r of s.resources) {
        if (!isSafeUrl(r.url)) err('R7', `roadmap ${s.id}`, `资源 url 不是 https：${r.url}`)
      }
    }
  }

  // R7 语言链接
  for (const m of metas) {
    for (const l of m.links) {
      if (!isSafeUrl(l.url)) err('R7', `meta ${m.id}`, `链接不是 https：${l.url}`)
    }
  }

  return {
    registry,
    metas,
    allLanguageIds,
    enabledLanguageIds,
    metaById,
    chapters,
    features,
    snippets,
    pitfalls,
    concepts,
    glossary,
    roadmaps,
    attributions,
    issues,
    stats: {
      featureCount: features.length,
      snippetCount,
      byState,
      byOrigin,
      coverage,
    },
  }
}

export function formatIssues(issues: Issue[]): string {
  if (!issues.length) return '  （无）'
  return issues
    .map((i) => `  ${i.level === 'error' ? '✗' : '!'} [${i.rule}] ${i.where}\n      ${i.message}`)
    .join('\n')
}
