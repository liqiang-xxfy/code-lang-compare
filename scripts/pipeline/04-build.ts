/**
 * 阶段 [4] build —— 把 content/ 编译成 src/generated/ 的类型化产物
 *
 *   YAML + Markdown
 *     → 双轴合并（topics × languages）
 *     → 抽取内联 @note（ADR-10）
 *     → 受限 Markdown 渲染（ADR-09）
 *     → Shiki 构建期预高亮（ADR-04）
 *     → emit：内容分片 / manifest / 台账 / 站点地图
 *
 * 刻意**不在构建期预计算 diff**：基准语言可由用户在 7 门中任选（42 种组合），
 * 且「只看差异」「展开行」都会改变实际渲染集合——运行时算更省（ADR-05）。
 */
import path from 'node:path'
import type {
  Manifest,
  RenderedChapter,
  RenderedSnippet,
  SnippetSource,
} from '../../src/schemas'
import { gzipSync } from 'node:zlib'
import { GENERATED_DIR, PUBLIC_DIR, extractNotes, loadI18n, rmrf, writeJson, writeText } from '../lib/core'
import { buildSearchIndexPayload } from './search-index'

/**
 * 搜索索引的 gzip 体积预算（不沿用 §9.1 给内容分片的 60 KB）。
 *
 * 为什么可以放宽：内容分片是「进章节就下载、直接影响首屏」的资源，
 * 而搜索索引只在 `/search` 路由按需下载，用户是**主动**要搜索才付出这份流量。
 *
 * 为什么要设线：索引大小随内容量近似线性增长，扩到 7 语言时会变成三四倍。
 * 超线就说明该做优化了（先去掉 @note 文本只留 summary，再考虑按内容域拆索引），
 * 而不是等它悄悄长到几百 KB 才发现。
 */
const SEARCH_INDEX_BUDGET_KB = 90
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

/**
 * 每条路由的 SEO 文案。
 *
 * 关键：**构建期**产出，写入 manifest.seo。于是
 *   · finalize-dist.mjs 注入静态 HTML 的 <title>/<meta description>
 *   · 客户端 usePageMeta 在导航时更新
 * 用的是同一份文案，不会出现「爬虫看到的和用户看到的不一致」。
 */
function buildSeo(a: ReturnType<typeof analyzeContent>, routes: string[]): Manifest['seo'] {
  const out: Manifest['seo'] = {}
  const { site } = a.registry
  const nameOf = (id: string) => a.metaById[id]?.name ?? id
  const metaOf = (id: string) => a.metaById[id]

  /**
   * 基准相关的静态文案片段。
   *
   * 预渲染 HTML 是 SEO 的**唯一**有效载体（爬虫首轮不执行 JS），所以基准这件事
   * 必须写死在静态文案里；客户端随后会用 localStorage 里的偏好改写可见文案
   * （见各 view 的 usePageMeta / HomeView），两者分工不同，不是重复。
   *
   * 文案同时给出「默认是谁」与「还能选谁」—— 基准不进 URL，没有专属落地页，
   * 这是候选基准能被搜索引擎看见的唯一位置。
   */
  const refName = nameOf(a.registry.equivalenceReference)
  const defaultBaselineName = nameOf(a.registry.defaultBaseline)
  const candidateNames = Object.values(a.metaById)
    .filter((m) => m.baseline)
    .map((m) => m.name)
  const baselinePhrase = candidateNames.length
    ? `基准可选 ${candidateNames.join(' / ')}，默认 ${defaultBaselineName}`
    : `以 ${defaultBaselineName} 为基准`

  for (const route of routes) {
    if (route === '/') {
      out[route] = {
        title: site.name,
        description: site.shortDescription,
      }
      continue
    }

    const langMatch = /^\/lang\/([^/]+)$/.exec(route)
    if (langMatch) {
      const id = langMatch[1]!
      const meta = metaOf(id)
      out[route] = {
        title: `${nameOf(id)} 对照入口`,
        description: `${nameOf(id)} 与 ${refName} 的心智模型对照、语言设计维度与生态差异。${meta?.paradigm.join('、') ?? ''}`,
      }
      continue
    }

    const chapterMatch = /^\/compare\/([^/]+)\/([^/]+)$/.exec(route)
    if (chapterMatch) {
      const chapterId = `${chapterMatch[1]}/${chapterMatch[2]}`
      const chapter = a.chapters.find((c) => c.id === chapterId)
      const topicTitle = a.registry.topics[chapter?.topicId ?? '']?.title ?? ''
      const featureTitles = (chapter?.features ?? []).map((f) => f.title)
      out[route] = {
        title: [topicTitle, chapter?.title].filter(Boolean).join(' · '),
        description: `${chapter?.title ?? ''}：${featureTitles.slice(0, 8).join('、')} 在 ${refName} 与${a.enabledLanguageIds
          .filter((x) => x !== a.registry.equivalenceReference)
          .map(nameOf)
          .join('、')}中的写法对照，含行为差异与迁移陷阱。${baselinePhrase}。`,
      }
      continue
    }

    const featureMatch = /^\/feature\/([^/]+)\/([^/]+)$/.exec(route)
    if (featureMatch) {
      const featureId = `${featureMatch[1]}/${featureMatch[2]}`
      const found = a.features.find((f) => f.feature.id === featureId)
      out[route] = {
        title: found ? `${found.feature.title} 的跨语言对照` : featureId,
        description: `${
          found?.feature.summary ?? `${featureId} 在 ${refName} 与其它语言中的写法、差异与注意事项。`
        }${baselinePhrase}。`,
      }
      continue
    }

    if (route === '/pitfalls') {
      out[route] = {
        title: '迁移陷阱清单',
        description: `以 ${refName} 为出发语言、按症状检索的跨语言迁移陷阱：${a.pitfalls
          .slice(0, 5)
          .map((p) => p.title)
          .join('、')} 等 ${a.pitfalls.length} 条。`,
      }
      continue
    }

    if (route === '/glossary') {
      out[route] = {
        title: '术语词典',
        description: `同名不同义 / 异名同义的跨语言术语对照：${a.glossary
          .slice(0, 8)
          .map((g) => g.term)
          .join('、')}。`,
      }
      continue
    }

    if (route === '/attributions') {
      out[route] = {
        title: '内容来源与许可',
        description: '内容来源、许可义务与履行位置的完整台账。',
      }
      continue
    }

    const roadmapMatch = /^\/roadmap\/([^/]+)$/.exec(route)
    if (roadmapMatch) {
      const id = roadmapMatch[1]!
      const stages = a.roadmaps[id] ?? []
      out[route] = {
        title: `${refName} → ${nameOf(id)} 学习路线`,
        description: `从 ${refName} 迁移到 ${nameOf(id)} 的 ${stages.length} 个阶段：目标、时长与验收标准。`,
      }
      continue
    }

    out[route] = { title: site.name, description: site.shortDescription }
  }

  return out
}

async function main(): Promise<void> {
  const t0 = Date.now()

  /* 1. 注册表（含 LanguageId 派生）—— 必须先于任何 src 侧编译 */
  const reg = generateRegistry()
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
    const { code, notes } = extractNotes(s.code, meta.comment.line)
    const hl = highlightSync(code, meta.shikiLang, mode)
    const out: RenderedSnippet = {
      lang,
      equivalence: s.equivalence,
      flags: s.flags,
      code,
      html: hl.html,
      lineCount: hl.lineCount,
      notes,
      reviewState: s.review.state,
      provenanceOrigin: s.review.provenance.origin,
    }
    if (hl.htmlDark) out.htmlDark = hl.htmlDark
    if (s.output) out.output = s.output.replace(/\s+$/, '')
    if (s.body) out.bodyHtml = renderMarkdown(md, s.body, mode, meta.shikiLang)
    return out
  }

  const renderedChapters: RenderedChapter[] = []
  for (const chapter of a.chapters) {
    if (!a.registry.topics[chapter.topicId]?.enabled) continue
    const renderedChapter: RenderedChapter = {
      id: chapter.id,
      topicId: chapter.topicId,
      title: chapter.title,
      order: chapter.order,
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
          snippets: Object.fromEntries(snippets.map((s) => [s.lang, s])),
        }
      }),
    }
    if (chapter.summary) renderedChapter.summary = chapter.summary
    renderedChapters.push(renderedChapter)
  }

  /* 5. 路由清单 —— 预渲染与 sitemap 共用同一来源，保证两者永远一致 */
  const routes = new Set<string>(['/', '/pitfalls', '/glossary', '/attributions'])
  for (const lang of enabled) routes.add(`/lang/${lang}`)
  for (const chapter of a.chapters) {
    if (a.registry.topics[chapter.topicId]?.enabled) routes.add(`/compare/${chapter.id}`)
  }
  for (const { feature, chapter } of a.features) {
    if (a.registry.topics[chapter.topicId]?.enabled) routes.add(`/feature/${feature.id}`)
  }
  for (const lang of Object.keys(a.roadmaps)) {
    if (enabled.includes(lang)) routes.add(`/roadmap/${lang}`)
  }
  const routeList = [...routes].sort()

  /*
   * 预渲染、但**不进 sitemap** 的路由。
   *
   * /search 的结果是客户端动态渲染的 —— 爬虫拿到的只会是一个空输入框，
   * 所以它不该进 sitemap（robots.txt 里也已 Disallow）。但用户会收藏、会深链访问，
   * 因此仍要预渲染出静态外壳。这两个清单分开是刻意的：混在一起会污染搜索引擎索引。
   */
  const PRERENDER_EXTRA = ['/search']

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

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    publishPolicy: a.registry.publishPolicy,
    routes: routeList,
    /**
     * 只放进 prerenderExtra，**不**放进 routes —— 后者同时驱动 sitemap.xml。
     * /search 混进 sitemap 会把一个空搜索框推给搜索引擎，是负资产。
     */
    prerenderExtra: PRERENDER_EXTRA,
    seo: buildSeo(a, routeList),
    topics: topicSummaries,
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

  writeJson(path.join(GENERATED_DIR, 'static.json'), {
    /** 踩坑的富文本在构建期渲染，运行时只消费 HTML（ADR-09） */
    pitfalls: a.pitfalls
      .map((p) => ({
        id: p.id,
        title: p.title,
        symptomHtml: renderMarkdown(md, p.symptom, mode),
        causeHtml: renderMarkdown(md, p.cause, mode),
        fixHtml: renderMarkdown(md, p.fix, mode),
        severity: p.severity,
        languages: p.languages,
        fromBaseline: p.fromBaseline,
        featureId: p.featureId,
        tags: p.tags,
      }))
      .sort((x, y) => y.severity - x.severity || x.id.localeCompare(y.id)),
    concepts: a.concepts,
    glossary: a.glossary,
    roadmaps: a.roadmaps,
  })

  /* 8. 搜索索引 —— §8.3 预留的 search-index 钩子在此落地 */
  const searchPayload = buildSearchIndexPayload(a, manifest.generatedAt)
  /*
   * `index` 刻意保持为**序列化后的字符串**，而不是直接嵌入对象。
   *
   * 实测：倒排表是「token → 长 docId 数组」的形状，一旦嵌成对象，
   * writeJson 的 2 空格缩进会把它从 334 KB 膨胀到 **975 KB**（近 3 倍）。
   * 保持字符串 + 紧凑落盘则是 334 KB —— 注意此时缩进与否只差 0.0 KB，
   * 因为外层 payload 只有 4 个字段，缩进影响不到嵌套字符串内部。
   * 换句话说：**省空间靠的是「保持字符串」，不是「紧凑格式」**，别把这两件事搞混。
   */
  const searchJson = JSON.stringify(searchPayload)
  writeText(path.join(GENERATED_DIR, 'search-index.json'), searchJson)

  const searchGzKb = gzipSync(Buffer.from(searchJson, 'utf8'), { level: 9 }).length / 1024
  console.log(
    `[build] search-index.json：${searchPayload.docCount} 条文档（` +
      Object.entries(searchPayload.byType)
        .filter(([, n]) => n > 0)
        .map(([type, n]) => `${type} ${n}`)
        .join(' / ') +
      `），${(searchJson.length / 1024).toFixed(0)} KB / ${searchGzKb.toFixed(0)} KB gzip`,
  )
  if (searchGzKb > SEARCH_INDEX_BUDGET_KB) {
    console.warn(
      `[build] ⚠ 搜索索引 ${searchGzKb.toFixed(0)} KB(gz) 已超预算 ${SEARCH_INDEX_BUDGET_KB} KB。` +
        ' 它只在 /search 按需下载、不进首屏，但持续增长会拖慢该页首屏。' +
        ' 优化路径：先去掉 @note 文本（只留 summary），再考虑按内容域拆索引。',
    )
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
    `[build] 完成：${a.stats.featureCount} Feature / ${a.stats.snippetCount} 实现 / ${routeList.length} 条路由（${ms}ms）`,
  )
}

await main()
