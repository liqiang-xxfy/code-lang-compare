/**
 * 阶段 [4] build —— 把 content/ 编译成 src/generated/ 的类型化产物
 *
 *   YAML + Markdown
 *     → 三轴合并（topic 的 section / baseline / target × languages）
 *     → 抽取内联 @note（ADR-10）
 *     → 受限 Markdown 渲染（ADR-09）
 *     → Shiki 构建期预高亮（ADR-04）
 *     → emit：内容分片 / manifest / 静态资源 / 搜索索引 / 台账 / 站点地图
 *
 * 刻意**不在构建期预计算 diff**：基准语言可切换、对比列可多选，
 * 且「只看差异」「展开行」都会改变实际渲染集合——运行时算更省（ADR-05）。
 */
import path from 'node:path'
import type {
  Manifest,
  ManifestPair,
  PairPayload,
  RenderedBlock,
  RenderedChapter,
  RenderedSnippet,
  Section,
  SnippetSource,
} from '../../src/schemas'
import { gzipSync } from 'node:zlib'
import { GENERATED_DIR, PUBLIC_DIR, extractNotes, loadI18n, rmrf, writeJson, writeText } from '../lib/core'
import { buildSearchIndexPayloads } from './search-index'
import { generateSections } from '../build/generate-sections'

/**
 * 搜索索引的 gzip 体积预算（不沿用 §9.1 给内容分片的 60 KB）。
 *
 * 为什么可以放宽：内容分片是「进章节就下载、直接影响首屏」的资源，
 * 而搜索索引只在 `/search` 路由按需下载，用户是**主动**要搜索才付出这份流量。
 *
 * 口径在 P7 改成了**单个分片**：索引按基准拆成三份，用户一次只下载一份。
 *
 * ── 2026-10-02 由 90 上调到 280 ──────────────────────────────────
 *
 * 原来的 90 KB 是一个估计值，从未达到过。实测（`gzip -9` 单分片）：
 *
 *      javascript 247 KB   python 145 KB   java 136 KB
 *
 * 这次上调是**承认现状**，不是把红线挪开当作没看见 —— 它仍然是一条增长告警：
 * 正文补齐还会往 text 里加内容，越过 280 时会像现在这样逐分片打印一行提示。
 *
 * 真正能回到 90 KB 的路径只有 ADR-21 写的那条（把 `@note` 文本与 body 降级为
 * summary-only，或按 section 域内检索），代价是牺牲检索精度 —— 注记是内容里
 * 检索价值最高的部分。所以它是一次独立的产品决策，不跟着架构改动顺手做。
 */
const SEARCH_INDEX_BUDGET_KB = 280
import { analyzeContent } from '../lib/analyze'
import {
  createMarkdown,
  highlightSync,
  initHighlighter,
  renderMarkdown,
  resolveHighlightMode,
  type HighlightMode,
} from '../lib/render'
import { resolveBasePath, resolveSiteUrl } from '../lib/env-paths'
import { generateRegistry } from '../build/generate-registry'

/**
 * 环境变量统一入口（PC_ 前缀 + 防 MSYS 路径转换），详见 scripts/lib/env-paths.ts
 */
const siteUrlResult = resolveSiteUrl()
const basePathResult = resolveBasePath()
const SITE_URL = siteUrlResult.value
const BASE_PATH = basePathResult.value.replace(/\/+$/, '')
if (siteUrlResult.warning) console.warn(`[build] ${siteUrlResult.warning}`)
if (basePathResult.warning) console.warn(`[build] ${basePathResult.warning}`)

/** 对级静态资源的文件名 —— 必须能从 (基准, 目标) 直接推出来，客户端不做反查 */
export const pairFileName = (baseline: string, target: string): string => `${baseline}--${target}`

/**
 * 每条路由的 SEO 文案。
 *
 * 关键：**构建期**产出，写入 manifest.seo。于是
 *   · finalize-dist 注入静态 HTML 的 <title>/<meta description>
 *   · 客户端 usePageMeta 在导航时更新
 * 用的是同一份文案，不会出现「爬虫看到的和用户看到的不一致」。
 *
 * P7 之后每个基准都有**自己的 URL**，所以文案里必须把基准名写进去：
 * 三套基础语法页面的 description 若长得一样，搜索引擎会判为重复内容。
 */
function buildSeo(a: ReturnType<typeof analyzeContent>, routes: string[]): Manifest['seo'] {
  const out: Manifest['seo'] = {}
  const { site } = a.registry
  const nameOf = (id: string) => a.metaById[id]?.name ?? id
  const metaOf = (id: string) => a.metaById[id]

  const topicOf = (topicId: string) => a.registry.topics[topicId]

  for (const route of routes) {
    if (route === '/') {
      out[route] = { title: site.name, description: site.shortDescription }
      continue
    }

    if (route === '/attributions') {
      out[route] = {
        title: '内容来源与许可',
        description: '内容来源、许可义务与履行位置的完整台账。',
      }
      continue
    }

    const langMatch = /^\/lang\/([^/]+)$/.exec(route)
    if (langMatch) {
      const id = langMatch[1]!
      const meta = metaOf(id)
      out[route] = {
        title: `${nameOf(id)} 语言入口`,
        description: `${nameOf(id)} 的语言设计维度、生态差异与心智模型对照。${meta?.paradigm.join('、') ?? ''}`,
      }
      continue
    }

    /*
     * /compare/<基准>/<板块>[/<章节 slug>]
     *
     * 文案**模板**在 registry.yaml 的 sections 段声明，这里只负责求值 ——
     * 此前是「四元嵌套三元 + 四个 if (section === …) + basics 单独一支」，
     * 加板块要在这段里再加一分支。
     *
     * 目标语言**不在地址里**，所以得按运行时同一套规则算出「默认会展示哪个方向」，
     * 否则静态 HTML 上写的方向与用户第一眼看到的会对不上。
     */
    const compareMatch = /^\/compare\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(route)
    if (compareMatch) {
      const [, baseline, section, slug] = compareMatch
      const def = a.registry.sections[section!]
      const baseName = nameOf(baseline!)
      if (!def) {
        out[route] = { title: site.name, description: site.shortDescription }
        continue
      }

      /** 该板块在这个基准下的 topic id —— 列表型板块没有 topic，为 undefined */
      const topicId = Object.entries(a.registry.topics).find(
        ([, t]) => t.baseline === baseline && t.section === section,
      )?.[0]

      /** 该板块在某个方向下真的有内容吗（判据与下方 manifest.pairs 的生成一致） */
      const hasContent = (target: string): boolean => {
        if (def.shape === 'chapter') {
          const t = Object.entries(a.registry.topics).find(
            ([, x]) => x.baseline === baseline && x.section === section && x.target === target,
          )?.[0]
          return !!t && a.chapters.some((c) => c.topicId === t)
        }
        const pair = a.pairs.find((p) => p.baseline === baseline && p.target === target)
        const items = (pair as unknown as Record<string, unknown> | undefined)?.[def.dataKey ?? '']
        return Array.isArray(items) && items.length > 0
      }

      // 对级板块：优先默认对比语言，否则该板块第一个真正有内容的方向
      let target: string | null = null
      if (def.scope === 'pair') {
        const available = [...new Set(a.pairs.map((p) => p.target))].filter(
          (t) => t !== baseline && hasContent(t),
        )
        target = available.includes(a.registry.defaultCompareLanguage)
          ? a.registry.defaultCompareLanguage
          : (available[0] ?? null)
        if (!target) {
          out[route] = { title: site.name, description: site.shortDescription }
          continue
        }
      }

      const targetName = target ? nameOf(target) : ''
      const chapter =
        def.shape === 'chapter' && slug
          ? a.chapters.find((c) => c.topicId === topicId && c.id.split('/')[1] === slug)
          : undefined
      const items =
        def.shape === 'list' && target
          ? (((a.pairs.find((p) => p.baseline === baseline && p.target === target) as unknown as
              | Record<string, unknown>
              | undefined)?.[def.dataKey ?? ''] ?? []) as unknown[])
          : []

      /* {sample}：章节型取前几个 feature 标题，列表型取前几条条目标题（词典是 term） */
      const titles =
        def.shape === 'chapter'
          ? (chapter?.features ?? []).map((f) => f.title)
          : items.map((x) => {
              const row = x as Record<string, unknown>
              return String(row.title ?? row.term ?? '')
            })

      const vars: Record<string, string> = {
        baseline: baseName,
        target: targetName,
        direction: target ? `${baseName} → ${targetName}` : baseName,
        chapterTitle: chapter?.title ?? slug ?? '',
        compared:
          def.scope === 'baseline' && topicId
            ? scopeOfTopic(a, topicId)
                .filter((x) => x !== baseline)
                .map(nameOf)
                .join('、')
            : '',
        count: String(items.length),
        sample: titles.slice(0, def.seo.sampleLimit ?? 8).join('、'),
      }

      out[route] = {
        title: renderSeoTemplate(def.seo.title, vars),
        description: renderSeoTemplate(def.seo.description, vars),
      }
      continue
    }

    const featureMatch = /^\/feature\/([^/]+)\/([^/]+)$/.exec(route)
    if (featureMatch) {
      const featureId = `${featureMatch[1]}/${featureMatch[2]}`
      const found = a.features.find((f) => f.feature.id === featureId)
      const cfg = found ? topicOf(found.chapter.topicId) : undefined
      const baseName = cfg ? nameOf(cfg.baseline) : ''
      out[route] = {
        title: found ? `${found.feature.title} 的跨语言对照` : featureId,
        description: `${
          found?.feature.summary
            ? `${found.feature.summary}。`
            : `${featureId} 在多门语言中的写法、差异与注意事项。`
        }${baseName ? `相对 ${baseName} 基准的对照。` : ''}`,
      }
      continue
    }

    out[route] = { title: site.name, description: site.shortDescription }
  }

  return out
}

/** SEO 模板求值：`{name}` → vars[name]；未知占位符留空，而不是把花括号原样输出到 meta 里 */
function renderSeoTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

/** 某个 topic 的适用语言范围 —— 必须与 analyze.ts 的 scopeOfTopic 保持同一判据 */
function scopeOfTopic(a: ReturnType<typeof analyzeContent>, topicId: string): string[] {
  const scope = a.registry.topics[topicId]?.languages
  if (!scope?.length) return [...a.enabledLanguageIds]
  return a.enabledLanguageIds.filter((id) => scope.includes(id))
}


async function main(): Promise<void> {
  const t0 = Date.now()

  /*
   * 1. 注册表 —— 必须先于任何 src 侧编译。
   *    SectionId 先于 LanguageId：src/schemas 的类型依赖前者（type-only，编译期擦除）。
   */
  const sectionIds = generateSections()
  const reg = generateRegistry()
  console.log(`[build] sections：${sectionIds.length} 个板块（${sectionIds.join(' → ')}）`)
  console.log(`[build] registry：全集 ${reg.allLanguageIds.length} 门，启用 ${reg.enabledLanguageIds.join(', ')}`)

  /* 2. 分析与校验 —— 构建也必须被校验挡住 */
  const a = analyzeContent()
  const errors = a.issues.filter((i) => i.level === 'error')
  if (errors.length) {
    console.error(`[build] 存在 ${errors.length} 条 error 级校验问题，已终止。请先跑 npm run content:validate`)
    process.exit(1)
  }

  const enabled = a.enabledLanguageIds
  const topics = Object.entries(a.registry.topics).filter(([, v]) => v.enabled)

  /* 3. 高亮（构建期，Shiki 不进客户端包） */
  const shikiLangs = enabled.map((id) => a.metaById[id]!.shikiLang)
  await initHighlighter([...shikiLangs, 'text'])
  const mode: HighlightMode = await resolveHighlightMode()
  console.log(`[build] 高亮方案：shiki / ${mode}${mode === 'dual' ? '（css-variables 不可用，已降级为双主题）' : ''}`)

  const md = createMarkdown()

  /* 4. 合并 + 渲染 */
  const renderSnippet = (lang: string, s: SnippetSource): RenderedSnippet => {
    const meta = a.metaById[lang]!

    /** 抽取内联 @note + Shiki 预高亮，作用于「一段」代码 */
    const renderCode = (raw: string) => {
      const r = extractNotes(raw, meta.comment.line)
      const hl = highlightSync(r.code, meta.shikiLang, mode)
      return {
        code: r.code,
        notes: r.notes,
        html: hl.html,
        htmlDark: hl.htmlDark,
        lineCount: hl.lineCount,
      }
    }

    /*
     * 多段（「错误写法 / 正确写法」这类对照）：逐段抽取与高亮。
     * 单段内容不走这条路径 —— 它的渲染结果与改动前逐字节相同。
     */
    const blocks: RenderedBlock[] | undefined = s.blocks?.length
      ? s.blocks.map((b) => {
          const r = renderCode(b.code)
          const blk: RenderedBlock = {
            label: b.label,
            code: r.code,
            html: r.html,
            lineCount: r.lineCount,
            notes: r.notes,
          }
          if (r.htmlDark) blk.htmlDark = r.htmlDark
          return blk
        })
      : undefined

    // 顶层是「各段拼接」：供复制，以及两侧段结构不一致时降级为整体 diff
    const top = renderCode(blocks ? blocks.map((b) => b.code).join('\n\n') : s.code)

    const out: RenderedSnippet = {
      lang,
      equivalence: s.equivalence,
      code: top.code,
      html: top.html,
      lineCount: top.lineCount,
      // 多段时各段已各自抽过注记，合并即可（顶层的抽取作用在已剥离的文本上，是空的）
      notes: blocks ? blocks.flatMap((b) => b.notes) : top.notes,
      reviewState: s.review.state,
      provenanceOrigin: s.review.provenance.origin,
    }
    if (blocks) out.blocks = blocks
    if (top.htmlDark) out.htmlDark = top.htmlDark
    if (s.output) out.output = s.output.replace(/\s+$/, '')
    if (s.body) out.bodyHtml = renderMarkdown(md, s.body, mode, meta.shikiLang)
    return out
  }

  const renderedChapters: RenderedChapter[] = []
  for (const chapter of a.chapters) {
    const cfg = a.registry.topics[chapter.topicId]
    if (!cfg?.enabled) continue
    const renderedChapter: RenderedChapter = {
      id: chapter.id,
      topicId: chapter.topicId,
      title: chapter.title,
      order: chapter.order,
      section: cfg.section,
      baseline: cfg.baseline,
      features: chapter.features.map((feature) => {
        const bucket = a.snippets.get(feature.id) ?? new Map<string, SnippetSource>()
        const snippets: RenderedSnippet[] = []
        for (const lang of enabled) {
          const s = bucket.get(lang)
          if (s) snippets.push(renderSnippet(lang, s))
        }
        return {
          id: feature.id,
          chapterId: chapter.id,
          title: feature.title,
          kind: feature.kind,
          summary: feature.summary,
          bodyHtml: renderMarkdown(md, feature.body, mode) || undefined,
          // 已由 R5 校验存在性，这里直接透传
          ...(feature.refFeatureId ? { refFeatureId: feature.refFeatureId } : {}),
          snippets: Object.fromEntries(snippets.map((s) => [s.lang, s])),
        }
      }),
    }
    if (chapter.summary) renderedChapter.summary = chapter.summary
    if (cfg.target) renderedChapter.target = cfg.target
    renderedChapters.push(renderedChapter)
  }

  /* 5. 路由清单 —— 预渲染与 sitemap 共用同一来源，保证两者永远一致 */
  const routes = new Set<string>(['/', '/attributions'])
  for (const lang of enabled) routes.add(`/lang/${lang}`)

  const slugOf = (chapterId: string) => chapterId.split('/')[1] ?? chapterId
  /*
   * 章节地址里**没有目标语言** —— 它由运行时的页内选择条决定（ADR-26 / ADR-27）。
   * 所以一个方向一个地址的局面变成了「一个基准下的一个板块一个地址」。
   */
  const chapterPath = (chapter: RenderedChapter): string => {
    const cfg = a.registry.topics[chapter.topicId]!
    const slug = slugOf(chapter.id)
    return cfg.section === 'basics'
      ? `/compare/${cfg.baseline}/basics/${slug}`
      : `/compare/${cfg.baseline}/${cfg.section}/${slug}`
  }
  for (const chapter of renderedChapters) routes.add(chapterPath(chapter))

  /*
   * 对级列表板块的路由**只在内容确实存在时才生成**。
   *
   * 沿用「只链确实有内容的」惯例：骨架期 12 个方向只做了一部分，
   * 凭空生成路由会得到一堆空白页，还会把死链写进 sitemap。
   * 判据是「该基准下**任意**方向有这个板块」—— 目标不进 URL，
   * 所以只要有一个方向有内容，这个地址就是有意义的。
   */
  const pairs: ManifestPair[] = []
  const sectionRoutes = new Set<string>()
  for (const pair of a.pairs) {
    const sections: Section[] = []
    if (a.registry.topics[pair.topicId]?.enabled) {
      const hasChapter = renderedChapters.some((c) => c.topicId === pair.topicId)
      if (hasChapter) sections.push('migration')
      if (pair.pitfalls.length) sections.push('pitfalls')
      if (pair.glossary.length) sections.push('glossary')
      if (pair.roadmaps.length) sections.push('roadmap')
      for (const s of sections) {
        if (s !== 'migration') sectionRoutes.add(`/compare/${pair.baseline}/${s}`)
      }
    }
    if (sections.length) pairs.push({ baseline: pair.baseline, target: pair.target, sections })
  }
  for (const r of sectionRoutes) routes.add(r)

  /* 特性页：basics / 新增基准的章节进 sitemap；迁移方向的重叠度高，只预渲染不索引 */
  const featureRoute = (featureId: string) => `/feature/${featureId}`
  const contentFeatureIds = new Set(renderedChapters.flatMap((c) => c.features.map((f) => f.id)))
  const migrationFeatureIds: string[] = []
  for (const { feature, chapter } of a.features) {
    if (!contentFeatureIds.has(feature.id)) continue
    const cfg = a.registry.topics[chapter.topicId]
    if (!cfg) continue
    if (cfg.section === 'migration') migrationFeatureIds.push(feature.id)
    else routes.add(featureRoute(feature.id))
  }

  const routeList = [...routes].sort()

  /*
   * 预渲染、但**不进 sitemap** 的路由。
   *
   * /search 的结果是客户端动态渲染的 —— 爬虫拿到的只会是一个空输入框，
   * 所以它不该进 sitemap（robots.txt 里也已 Disallow）。但用户会收藏、会深链访问，
   * 因此仍要预渲染出静态外壳。这两个清单分开是刻意的：混在一起会污染搜索引擎索引。
   *
   * 迁移特性页同理：它们与所在章节页内容高度重叠，进 sitemap 是近重复内容；
   * 但单条特性链接确实会被分享，所以仍然预渲染。
   */
  /*
   * 旧地址也要预渲染出外壳。静态托管（GitHub Pages）做不了服务端 301，
   * 不生成这些文件的话旧链接会直接落到 404.html；生成之后 SPA 会正常重定向。
   * 它们同样**不进 sitemap** —— 是过渡期的兼容地址，不该被索引。
   */
  const LEGACY_PATHS = [
    '/pitfalls',
    '/glossary',
    ...enabled.map((id) => `/roadmap/${id}`),
  ]

  const PRERENDER_EXTRA = [
    '/search',
    ...migrationFeatureIds.sort().map(featureRoute),
    ...LEGACY_PATHS,
  ]

  /* 6. emit */
  const contentDir = path.join(GENERATED_DIR, 'content')
  rmrf(contentDir)

  /*
   * 分片粒度 = 一章一个文件（`content/<topicId>/<chapterSlug>.json`）。
   *
   * 为什么不是「一 topic 一个文件」：首期定稿时按 topic 分片，8 个 Feature 的量级下没问题；
   * 但内容补到 72 个 Feature 后，单个 topic 分片涨到 732 KB —— 远超 §9.1 设定的
   * 「单分片 ≤ 60 KB(gz)」预算，首屏要下载整章 8 倍的数据。这正是 §9.1 里写明的
   * 「单章分片超预算就按 section 细分片」的触发条件，现在触发并修正。
   * 同时它也更贴合真实访问模式：用户几乎总是访问某一章，而不是「整个基础语法」。
   */
  for (const chapter of renderedChapters) {
    writeJson(path.join(contentDir, `${chapter.id}.json`), chapter)
  }

  const topicSummaries: Manifest['topics'] = topics.map(([topicId, topicConfig]) => ({
    id: topicId,
    title: topicConfig.title,
    section: topicConfig.section,
    baseline: topicConfig.baseline,
    ...(topicConfig.target ? { target: topicConfig.target } : {}),
    chapters: renderedChapters
      .filter((c) => c.topicId === topicId)
      .sort((x, y) => x.order - y.order)
      .map((c) => ({
        id: c.id,
        title: c.title,
        order: c.order,
        featureIds: c.features.map((f) => f.id),
      })),
  }))

  const featureIndex: Manifest['featureIndex'] = {}
  for (const chapter of a.chapters) {
    for (const feature of chapter.features) {
      featureIndex[feature.id] = {
        title: feature.title,
        chapterId: chapter.id,
        topicId: chapter.topicId,
      }
    }
  }

  /*
   * 板块注册表进 manifest —— 客户端据它排左栏、决定语言控件形态、选渲染器。
   * 与 registry.yaml 的 sections 段同源，按 order 排序（板块顺序是策展决策，不是字母序）。
   */
  const sectionDefs: Manifest['sections'] = Object.entries(a.registry.sections)
    // 键就是 SectionId 的来源（sections.gen.ts 由它生成），断言安全
    .map(([id, def]) => ({ id: id as Section, ...def }))
    .sort((x, y) => x.order - y.order)

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    publishPolicy: a.registry.publishPolicy,
    routes: routeList,
    prerenderExtra: PRERENDER_EXTRA,
    seo: buildSeo(a, routeList),
    sections: sectionDefs,
    topics: topicSummaries,
    pairs: pairs.sort(
      (x, y) => x.baseline.localeCompare(y.baseline) || x.target.localeCompare(y.target),
    ),
    featureIndex,
    counts: {
      features: a.stats.featureCount,
      snippets: a.stats.snippetCount,
      byState: a.stats.byState,
    },
  }
  writeJson(path.join(GENERATED_DIR, 'manifest.json'), manifest)

  writeJson(path.join(GENERATED_DIR, 'attributions.json'), {
    generatedAt: manifest.generatedAt,
    siteLicense: 'MIT',
    entries: a.attributions,
  })

  /*
   * 静态资源按对拆文件：`static/<baseline>--<target>.json`。
   * （心智模型曾是这里的全局 `static/concepts.json`，ADR-31 之后它是普通板块，
   * 内容走章节分片，这个文件已不再产出。）
   *
   * 为什么不是单个 static.json：12 个方向的陷阱/词典/路线合起来会变成主包里的
   * 常驻体积，而用户一次只看一个方向。拆开后可懒加载 —— 代价是三个列表视图
   * 改成「守卫里 ensure + 视图同步读」，与章节页取数方式统一。
   */
  const staticDir = path.join(GENERATED_DIR, 'static')
  rmrf(staticDir)

  for (const pair of a.pairs) {
    const payload: PairPayload = {
      baseline: pair.baseline,
      target: pair.target,
      pitfalls: pair.pitfalls
        .map((p) => ({
          id: p.id,
          title: p.title,
          symptomHtml: renderMarkdown(md, p.symptom, mode),
          causeHtml: renderMarkdown(md, p.cause, mode),
          fixHtml: renderMarkdown(md, p.fix, mode),
          severity: p.severity,
          languages: p.languages,
          fromBaseline: p.fromBaseline,
          ...(p.featureId ? { featureId: p.featureId } : {}),
          tags: p.tags,
          baseline: p.baseline,
          target: p.target,
        }))
        .sort((x, y) => y.severity - x.severity || x.id.localeCompare(y.id)),
      glossary: pair.glossary,
      roadmaps: pair.roadmaps,
    }
    writeJson(path.join(staticDir, `${pairFileName(pair.baseline, pair.target)}.json`), payload)
  }

  /* 8. 搜索索引 —— 按基准分片（详见 search-index.ts 的 buildSearchIndexPayloads） */
  const searchPayloads = buildSearchIndexPayloads(a, manifest.generatedAt)
  const searchDir = path.join(GENERATED_DIR, 'search-index')
  rmrf(searchDir)
  for (const [baseline, payload] of Object.entries(searchPayloads)) {
    const json = JSON.stringify(payload)
    writeText(path.join(searchDir, `${baseline}.json`), json)
    const gzKb = gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).length / 1024
    console.log(
      `[build] search-index/${baseline}.json：${payload.docCount} 条（` +
        Object.entries(payload.byType)
          .filter(([, n]) => n > 0)
          .map(([type, n]) => `${type} ${n}`)
          .join(' / ') +
        `），${(json.length / 1024).toFixed(0)} KB / ${gzKb.toFixed(0)} KB gzip`,
    )
    if (gzKb > SEARCH_INDEX_BUDGET_KB) {
      console.warn(
        `[build] ⚠ 搜索索引分片 ${baseline} ${gzKb.toFixed(0)} KB(gz) 已超预算 ${SEARCH_INDEX_BUDGET_KB} KB。` +
          ' 它只在 /search 按需下载、不进首屏，但持续增长会拖慢该页首屏。' +
          ' 优化路径：先去掉 @note 文本（只留 summary），再考虑按 section 拆索引。',
      )
    }
  }

  writeJson(path.join(GENERATED_DIR, 'i18n.json'), loadI18n())

  /* 7. SEO 落盘：sitemap + robots */
  if (SITE_URL) {
    const urls = routeList
      .map((r) => `  <url><loc>${SITE_URL}${BASE_PATH}${r === '/' ? '/' : r}</loc></url>`)
      .join('\n')
    writeText(
      path.join(PUBLIC_DIR, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    )
    writeText(
      path.join(PUBLIC_DIR, 'robots.txt'),
      `User-agent: *\nAllow: /\nDisallow: /search\n\nSitemap: ${SITE_URL}${BASE_PATH}/sitemap.xml\n`,
    )
    console.log(`[build] sitemap.xml：${routeList.length} 条 URL（${SITE_URL}${BASE_PATH}）`)
  } else {
    console.warn(
      '[build] 未设置 PC_SITE_URL，已跳过 sitemap.xml。\n' +
        '        部署前请设置：PC_SITE_URL=https://<你的域名> PC_BASE_PATH=/<仓库名>/ npm run build\n' +
        '        （不生成假的 sitemap 是刻意的：错误的 loc 会污染搜索引擎索引）',
    )
    writeText(path.join(PUBLIC_DIR, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /search\n')
  }

  const ms = Date.now() - t0
  console.log(
    `[build] 完成：${a.stats.featureCount} Feature / ${a.stats.snippetCount} 实现 / ` +
      `${routeList.length} 条可索引路由（+${PRERENDER_EXTRA.length} 条仅预渲染）（${ms}ms）`,
  )
}

await main()
