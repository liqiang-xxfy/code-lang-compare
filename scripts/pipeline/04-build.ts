/**
 * 阶段 [4] build —— 把 content/ 编译成 src/generated/ 的类型化产物（v2）
 *
 *   YAML + Markdown
 *     → 按语言装载对比框（清单在 catalog，写法在 languages/<语言>/<板块>/）
 *     → 抽取内联 @note（ADR-10）
 *     → 受限 Markdown 渲染（ADR-09）
 *     → Shiki 构建期预高亮（ADR-04）
 *     → emit：清单 / 内容分片 / manifest / 静态资源 / 搜索索引 / 台账 / 站点地图
 *
 * v2 与 v1 的两处根本差别：
 *   ① 内容分片是「一门语言 × 一个章节」（`content/<语言>/<板块>/<章节>.json`），
 *      一个章节页按可见列加载 N 份；清单与语言无关，单独出 `catalog.json`
 *   ② 第 ③ 槽（说明）**按角色预渲染两套**：`baselineHtml`（作基准列）与
 *      `vsHtml[基准]`（作对比列）—— 构建期不知道用户会选哪个基准，只能都渲染出来
 *
 * 刻意**不在构建期预计算 diff**：基准可切、对比列可多选、
 * 且「只看差异」会改变实际渲染集合——运行时算更省（ADR-05）。
 */
import path from 'node:path'
import type {
  BaselineCatalog,
  BoxSource,
  CatalogChapter,
  Manifest,
  ManifestPair,
  PairPayload,
  RenderedBaselineCatalog,
  RenderedBlock,
  RenderedBox,
  RenderedBoxChapter,
  RenderedCatalog,
  Section,
} from '../../src/schemas'
import { gzipSync } from 'node:zlib'
import {
  GENERATED_DIR,
  PUBLIC_DIR,
  extractNotes,
  groupsOfPool,
  loadI18n,
  rmrf,
  writeJson,
  writeText,
} from '../lib/core'
import { buildSearchIndexPayloads } from './search-index'
import { generateSections } from '../build/generate-sections'

/**
 * 搜索索引的 gzip 体积预算（单个分片）。
 *
 * 口径在 v2 改成**按语言分片**：一门语言的对比框只索引一次，全站总量 ≈ 1×。
 * 旧架构按基准分片时，同一段文字要在 3 个分片里各存一份（总量 ≈ 3×）。
 * 索引只在 `/search` 按需下载，不进首屏。
 *
 * 越过预算时会逐分片打印一行提示 —— 它是增长告警，不是硬闸门。
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

type A = ReturnType<typeof analyzeContent>

/**
 * 某个 (基准, 板块) 下**默认展示**的目标语言。
 *
 * 判据必须与运行时 `resolvePairTarget` 的首访分支一致（默认对比语言优先，
 * 否则该板块第一个可用方向）—— 目标不进 URL，但预渲染出来的那一页确实在讲
 * 某个方向，SEO 文案说的必须就是它。
 */
function pickPairTarget(a: A, baseline: string, section: Section): string | null {
  const available = a.pairs
    .filter((p) => p.baseline === baseline && hasPairSection(p, section))
    .map((p) => p.target)
    .sort()
  if (!available.length) return null
  return available.includes(a.registry.defaultCompareLanguage)
    ? a.registry.defaultCompareLanguage
    : available[0]!
}

/**
 * 某一章引用了哪些**存放组** —— 这一页要加载的内容分片就是它。
 *
 * **必须与运行时的同名辅助函数同判据**（`src/content/repository.ts`）：构建期用它决定
 * 「这一页值不值得产出」，运行时用它决定「加载哪几份分片」。两边分叉 = 空白页且不报错。
 */
function groupsOfChapter(a: A, baseline: string, section: string, chapter: string): string[] {
  const cat = a.catalogOf[`${baseline}/${section}`]
  const ch = cat?.chapters.find((x) => x.id === chapter)
  const pool = a.poolBySection[section]
  if (!ch || !pool) return []
  const byId = new Map(pool.features.map((f) => [f.id, f]))
  const out: string[] = []
  for (const id of ch.features) {
    const f = byId.get(id)
    if (f && !out.includes(f.group)) out.push(f.group)
  }
  return out
}

/** 构建产物里的章节：源文件的 `features` 只是 id 引用，这里 join 成池里的对象 */
function renderChapter(pool: A['pools'][number] | undefined, ch: BaselineCatalog['chapters'][number]): CatalogChapter {
  const byId = new Map(pool?.features.map((f) => [f.id, f]) ?? [])
  const out: CatalogChapter = {
    id: ch.id,
    title: ch.title,
    features: ch.features.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f)),
  }
  if (ch.summary) out.summary = ch.summary
  return out
}

function hasPairSection(p: A['pairs'][number], section: Section): boolean {
  switch (section) {
    case 'pitfalls':
      return p.pitfalls.length > 0
    case 'glossary':
      return p.glossary.length > 0
    case 'roadmap':
      return p.roadmaps.length > 0
    default:
      return false
  }
}

/**
 * 每条路由的 SEO 文案。
 *
 * 关键：**构建期**产出，写入 manifest.seo。于是
 *   · finalize-dist 注入静态 HTML 的 <title>/<meta description>
 *   · 客户端 usePageMeta 在导航时更新
 * 用的是同一份文案，不会出现「爬虫看到的和用户看到的不一致」。
 *
 * 章节型板块没有单一 target（列由页内多选决定），所以 `{compared}` 用
 * 「已启用语言 − 基准」这个确定集合；列表型板块仍按默认方向求值。
 */
function buildSeo(a: A, routes: string[]): Manifest['seo'] {
  const out: Manifest['seo'] = {}
  const { site } = a.registry
  const nameOf = (id: string) => a.metaById[id]?.name ?? id
  const comparedOf = (baseline: string) =>
    a.enabledLanguageIds
      .filter((id) => id !== baseline)
      .map(nameOf)
      .join('、')

  for (const route of routes) {
    if (route === '/') {
      out[route] = { title: site.name, description: site.shortDescription }
      continue
    }
    if (route === '/attributions') {
      out[route] = { title: '内容来源与许可', description: '内容来源、许可义务与履行位置的完整台账。' }
      continue
    }

    const langMatch = /^\/lang\/([^/]+)$/.exec(route)
    if (langMatch) {
      const id = langMatch[1]!
      const meta = a.metaById[id]
      out[route] = {
        title: `${nameOf(id)} 语言入口`,
        description: `${nameOf(id)} 的语言设计维度、生态差异与心智模型对照。${meta?.paradigm.join('、') ?? ''}`,
      }
      continue
    }

    /* /compare/<基准>/<板块>/<章节> —— 章节型 */
    const chapterMatch = /^\/compare\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(route)
    if (chapterMatch) {
      const [, baseline, section, chapterId] = chapterMatch
      const def = a.registry.sections[section!]
      // **按 (基准, 板块) 取章** —— 章节分组每个基准各一份，取错了会静默回落到站点默认文案
      const chapter = a.catalogOf[`${baseline}/${section}`]?.chapters.find((c) => c.id === chapterId)
      if (!def || !chapter) {
        out[route] = { title: site.name, description: site.shortDescription }
        continue
      }
      const byId = new Map(a.poolBySection[section!]?.features.map((f) => [f.id, f]) ?? [])
      const vars: Record<string, string> = {
        baseline: nameOf(baseline!),
        chapterTitle: chapter.title,
        sample: chapter.features
          .map((id) => byId.get(id)?.title ?? id)
          .slice(0, def.seo.sampleLimit ?? 8)
          .join('、'),
        compared: comparedOf(baseline!),
      }
      out[route] = {
        title: renderSeoTemplate(def.seo.title, vars),
        description: renderSeoTemplate(def.seo.description, vars),
      }
      continue
    }

    /* /compare/<基准>/<板块> —— 列表型 */
    const listMatch = /^\/compare\/([^/]+)\/([^/]+)$/.exec(route)
    if (listMatch) {
      const [, baseline, section] = listMatch
      const def = a.registry.sections[section!]
      const target = def ? pickPairTarget(a, baseline!, section as Section) : null
      if (!def || !target) {
        out[route] = { title: site.name, description: site.shortDescription }
        continue
      }
      const pair = a.pairs.find((p) => p.baseline === baseline && p.target === target)
      const items = ((pair as unknown as Record<string, unknown> | undefined)?.[def.dataKey ?? ''] ??
        []) as unknown[]
      const vars: Record<string, string> = {
        baseline: nameOf(baseline!),
        target: nameOf(target),
        direction: `${nameOf(baseline!)} → ${nameOf(target)}`,
        chapterTitle: '',
        compared: '',
        count: String(items.length),
        sample: items
          .slice(0, def.seo.sampleLimit ?? 8)
          .map((x) => {
            const row = x as Record<string, unknown>
            return String(row.title ?? row.term ?? '')
          })
          .join('、'),
      }
      out[route] = {
        title: renderSeoTemplate(def.seo.title, vars),
        description: renderSeoTemplate(def.seo.description, vars),
      }
      continue
    }

    /* /feature/<板块>/<feature> —— 全局 id 两段，与基准解耦 */
    const featureMatch = /^\/feature\/([^/]+)\/([^/]+)$/.exec(route)
    if (featureMatch) {
      const gid = `${featureMatch[1]}/${featureMatch[2]}`
      const entry = a.featureIndex[gid]
      const feature = a.features.find((f) => f.id === gid)?.feature
      out[route] = {
        title: entry ? `${entry.title} 的跨语言对照` : gid,
        description: feature?.summary
          ? `${feature.summary}。多门语言的写法、差异与注意事项。`
          : `${gid} 在多门语言中的写法、差异与注意事项。`,
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

async function main(): Promise<void> {
  const t0 = Date.now()

  /*
   * 1. 注册表 —— 必须先于任何 src 侧编译。
   *    SectionId 先于 LanguageId：src/schemas 的类型依赖前者（type-only，编译期擦除）。
   */
  const sectionIds = generateSections()
  const reg = generateRegistry()
  console.log(`[build] sections：${sectionIds.length} 个板块（${sectionIds.join(' → ')}）`)
  console.log(
    `[build] registry：全集 ${reg.allLanguageIds.length} 门，启用 ${reg.enabledLanguageIds.join(', ')}`,
  )

  /* 2. 分析与校验 —— 构建也必须被校验挡住 */
  const a = analyzeContent()
  const errors = a.issues.filter((i) => i.level === 'error')
  if (errors.length) {
    console.error(`[build] 存在 ${errors.length} 条 error 级校验问题，已终止。请先跑 npm run content:validate`)
    process.exit(1)
  }

  const enabled = a.enabledLanguageIds

  /* 3. 高亮（构建期，Shiki 不进客户端包） */
  const shikiLangs = enabled.map((id) => a.metaById[id]!.shikiLang)
  await initHighlighter([...shikiLangs, 'text'])
  const mode: HighlightMode = await resolveHighlightMode()
  console.log(
    `[build] 高亮方案：shiki / ${mode}${mode === 'dual' ? '（css-variables 不可用，已降级为双主题）' : ''}`,
  )

  const md = createMarkdown()

  /* 4. 渲染一个对比框 */
  const renderBox = (lang: string, box: BoxSource): RenderedBox => {
    const meta = a.metaById[lang]!

    /** 抽取内联 @note + Shiki 预高亮，作用于「一段」代码 */
    const renderCode = (raw: string) => {
      const r = extractNotes(raw, meta.comment.line)
      const hl = highlightSync(r.code, meta.shikiLang, mode)
      return { code: r.code, notes: r.notes, html: hl.html, htmlDark: hl.htmlDark, lineCount: hl.lineCount }
    }

    /*
     * 多段（「错误写法 / 正确写法」这类对照）：逐段抽取与高亮。
     * 单段内容不走这条路径 —— 它的渲染结果与改动前逐字节相同。
     */
    const blocks: RenderedBlock[] | undefined = box.blocks?.length
      ? box.blocks.map((b) => {
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
    const top = renderCode(blocks ? blocks.map((b) => b.code).join('\n\n') : box.code)

    const out: RenderedBox = {
      lang,
      code: top.code,
      html: top.html,
      lineCount: top.lineCount,
      // 多段时各段已各自抽过注记，合并即可（顶层的抽取作用在已剥离的文本上，是空的）
      notes: blocks ? blocks.flatMap((b) => b.notes) : top.notes,
      absent: box.absent,
      // 等价性按基准分：视图取 `equivalence[当前基准]`，缺 key = identical
      equivalence: box.equivalence as RenderedBox['equivalence'],
      reviewState: box.review.state,
      provenanceOrigin: box.review.provenance.origin,
    }
    if (blocks) out.blocks = blocks
    if (top.htmlDark) out.htmlDark = top.htmlDark
    if (box.output) out.output = box.output.replace(/\s+$/, '')

    /*
     * 第 ③ 槽 —— 两套角色都预渲染出来。构建期不知道用户会选哪个基准，
     * 所以不能只渲染「当前基准」那一份。
     */
    if (box.baseline?.trim()) out.baselineHtml = renderMarkdown(md, box.baseline, mode, meta.shikiLang)
    const vsHtml: Record<string, string> = {}
    for (const [base, text] of Object.entries(box.vs)) {
      if (text.trim()) vsHtml[base] = renderMarkdown(md, text, mode, meta.shikiLang)
    }
    if (Object.keys(vsHtml).length) out.vsHtml = vsHtml

    return out
  }

  /* 5. emit 内容分片 —— 一门语言 × 一个**存放组**一个文件 */
  const contentDir = path.join(GENERATED_DIR, 'content')
  rmrf(contentDir)
  /** 实际产出的分片键 `<语言>/<板块>/<存放组>` —— 路由生成要用它判断「这一页有没有内容」 */
  const emitted = new Set<string>()
  for (const lang of enabled) {
    for (const pool of a.pools) {
      for (const group of groupsOfPool(pool)) {
        const g = a.content.get(`${lang}/${pool.section}/${group}`)
        if (!g) continue
        const boxes: Record<string, RenderedBox> = {}
        for (const [featureId, box] of Object.entries(g.boxes)) {
          boxes[featureId] = renderBox(lang, box)
        }
        const shard: RenderedBoxChapter = {
          lang,
          section: pool.section as Section,
          group,
          boxes,
        }
        writeJson(path.join(contentDir, lang, pool.section, `${group}.json`), shard)
        emitted.add(`${lang}/${pool.section}/${group}`)
      }
    }
  }

  /* 清单产物 —— 两层：每基准一份的章节分组（features 已 join 池字段）+ 与基准无关的索引 */
  const generatedAt = new Date().toISOString()
  const renderedCatalogs: RenderedBaselineCatalog[] = a.catalogs.map((c) => ({
    section: c.section as Section,
    baseline: c.baseline,
    chapters: c.chapters.map((ch) => renderChapter(a.poolBySection[c.section], ch)),
  }))
  const catalogPayload: RenderedCatalog = {
    generatedAt,
    catalogs: renderedCatalogs,
    featureIndex: a.featureIndex as RenderedCatalog['featureIndex'],
  }
  writeJson(path.join(GENERATED_DIR, 'catalog.json'), catalogPayload)

  /* 6. 路由清单 —— 预渲染与 sitemap 共用同一来源，保证两者永远一致 */
  const routes = new Set<string>(['/', '/attributions'])
  for (const lang of enabled) routes.add(`/lang/${lang}`)

  const chapterPath = (baseline: string, section: string, chapter: string) =>
    `/compare/${baseline}/${section}/${chapter}`
  /*
   * 章节页只在**基准自己写了这一章引用的某个存放组**时产出 ——
   * 否则基准列是一片空白，这一页没有参照系，不该进 sitemap。
   *
   * 迁移期只要求「至少一个」；内容铺满后应收紧成「全部齐备」（那时基准列才无空洞，
   * 对应的信号是 R27 归零）。
   */
  for (const c of a.catalogs) {
    for (const chapter of c.chapters) {
      const groups = groupsOfChapter(a, c.baseline, c.section, chapter.id)
      if (!groups.some((g) => emitted.has(`${c.baseline}/${c.section}/${g}`))) continue
      routes.add(chapterPath(c.baseline, c.section, chapter.id))
    }
  }

  /*
   * 对级列表板块的路由**只在内容确实存在时才生成**（沿用「只链确实有内容的」惯例）。
   * 判据是「该基准下**任意**方向有这个板块」—— 目标不进 URL，
   * 所以只要有一个方向有内容，这个地址就是有意义的。
   */
  const pairs: ManifestPair[] = []
  for (const pair of a.pairs) {
    const sections: Section[] = []
    if (pair.pitfalls.length) sections.push('pitfalls')
    if (pair.glossary.length) sections.push('glossary')
    if (pair.roadmaps.length) sections.push('roadmap')
    if (!sections.length) continue
    pairs.push({ baseline: pair.baseline, target: pair.target, sections })
    for (const s of sections) routes.add(`/compare/${pair.baseline}/${s}`)
  }

  /* 特性页：只在至少一门语言写了这个框时才产出（否则是一页空白） */
  const featureRoute = (gid: string) => `/feature/${gid}`
  for (const f of a.features) {
    if (a.boxes.has(f.id)) routes.add(featureRoute(f.id))
  }

  const routeList = [...routes].sort()

  /*
   * 预渲染、但**不进 sitemap** 的路由。
   *
   * /search 的结果是客户端动态渲染的 —— 爬虫拿到的只会是一个空输入框，
   * 所以它不该进 sitemap（robots.txt 里也已 Disallow）。但用户会收藏、会深链访问，
   * 因此仍要预渲染出静态外壳。
   *
   * v2 取消了旧地址的兼容外壳（旧 URL 一律 404，见 ADR 决策），所以这里只剩一项。
   */
  const PRERENDER_EXTRA = ['/search']

  const sectionDefs: Manifest['sections'] = Object.entries(a.registry.sections)
    // 键就是 SectionId 的来源（sections.gen.ts 由它生成），断言安全
    .map(([id, def]) => ({ id: id as Section, ...def }))
    .sort((x, y) => x.order - y.order)

  const manifest: Manifest = {
    generatedAt,
    publishPolicy: a.registry.publishPolicy,
    routes: routeList,
    prerenderExtra: PRERENDER_EXTRA,
    seo: buildSeo(a, routeList),
    sections: sectionDefs,
    pairs: pairs.sort(
      (x, y) => x.baseline.localeCompare(y.baseline) || x.target.localeCompare(y.target),
    ),
    counts: {
      features: a.stats.featureCount,
      boxes: a.stats.boxCount,
      byState: a.stats.byState,
    },
  }
  writeJson(path.join(GENERATED_DIR, 'manifest.json'), manifest)

  writeJson(path.join(GENERATED_DIR, 'attributions.json'), {
    generatedAt,
    siteLicense: 'MIT',
    entries: a.attributions,
  })

  /*
   * 静态资源按对拆文件：`static/<基准>--<目标>.json`。
   * 键与形状沿用 v1（契约未变），只是来源换成了 content/pairs/。
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

  /* 8. 搜索索引 —— 按语言分片（详见 search-index.ts） */
  const searchPayloads = buildSearchIndexPayloads(a, generatedAt)
  const searchDir = path.join(GENERATED_DIR, 'search-index')
  rmrf(searchDir)
  for (const [lang, payload] of Object.entries(searchPayloads)) {
    const json = JSON.stringify(payload)
    writeText(path.join(searchDir, `${lang}.json`), json)
    const gzKb = gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).length / 1024
    console.log(
      `[build] search-index/${lang}.json：${payload.docCount} 条（` +
        Object.entries(payload.byType)
          .filter(([, n]) => n > 0)
          .map(([type, n]) => `${type} ${n}`)
          .join(' / ') +
        `），${(json.length / 1024).toFixed(0)} KB / ${gzKb.toFixed(0)} KB gzip`,
    )
    if (gzKb > SEARCH_INDEX_BUDGET_KB) {
      console.warn(
        `[build] ⚠ 搜索索引分片 ${lang} ${gzKb.toFixed(0)} KB(gz) 已超预算 ${SEARCH_INDEX_BUDGET_KB} KB。` +
          ' 它只在 /search 按需下载、不进首屏，但持续增长会拖慢该页首屏。' +
          ' 优化路径：先去掉 @note 文本（只留 summary），再考虑按板块拆索引。',
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
    `[build] 完成：${a.stats.featureCount} Feature / ${a.stats.boxCount} 对比框 / ` +
      `${routeList.length} 条可索引路由（+${PRERENDER_EXTRA.length} 条仅预渲染）（${ms}ms）`,
  )
}

await main()
