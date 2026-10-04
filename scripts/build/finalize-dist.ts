/**
 * 构建后处理（SEO 收口）—— 在 vite-ssg 产出预渲染 HTML 之后运行。
 *
 * 做三件事：
 *  1. 给**每条路由**的静态 HTML 注入属于它自己的 <title> / <meta description> / canonical
 *     （vite-ssg 渲染出的是内容，但 <head> 里的标题还是 index.html 的兜底值）
 *  2. 生成 dist/404.html —— GitHub Pages 没有 rewrite，深链直接命中 404 时必须回落到 SPA
 *  3. **验收**：检查每条路由的 HTML 里真的含该页的内容文本。
 *     这一步是「SEO 必须能被收录」这条硬需求的可执行验收条件 ——
 *     不做的话，「预渲染了但预渲染出来是空壳」这种失败会一路滑到线上。
 */
import fs from 'node:fs'
import path from 'node:path'
import { defaultCompareLanguageId, getLanguageMeta } from '../../src/generated/registry.gen'
import { resolveBasePath, resolveSiteUrl } from '../lib/env-paths'

const DIST = path.resolve('dist')
const MANIFEST_PATH = path.resolve('src/generated/manifest.json')
const CATALOG_PATH = path.resolve('src/generated/catalog.json')

const siteUrlResult = resolveSiteUrl()
const basePathResult = resolveBasePath()
const SITE_URL = siteUrlResult.value
const BASE_PATH = basePathResult.value.replace(/\/+$/, '')
if (siteUrlResult.warning) console.warn(`[finalize] ${siteUrlResult.warning}`)
if (basePathResult.warning) console.warn(`[finalize] ${basePathResult.warning}`)

interface Manifest {
  routes: string[]
  /** 预渲染但**不进 sitemap** 的额外路由（/search）—— 详细理由见 04-build.ts */
  prerenderExtra?: string[]
  seo: Record<string, { title: string; description: string }>
  pairs: Array<{ baseline: string; target: string; sections: string[] }>
  sections: Array<{ id: string; shape: string; scope: string; dataKey?: string }>
}

/**
 * 章节树与 feature 索引单独成文件（见 `RenderedCatalog`）。
 *
 * **`catalogs` 是每基准一份的**（S6.5）：章节分类按基准各来一份，所以查一章
 * 必须同时给出 (板块, 基准) —— 只按板块查会拿到另一个基准的章节。另外章节 id
 * 由**运行时的基准**决定，查不到时返回 null 就会静默跳过验收（见 `probeTextFor`）。
 */
interface Catalog {
  featureIndex: Record<string, { title: string }>
  catalogs: Array<{
    section: string
    baseline: string
    chapters: Array<{ id: string; title: string }>
  }>
}

if (!fs.existsSync(MANIFEST_PATH) || !fs.existsSync(CATALOG_PATH)) {
  console.error('[finalize] 找不到 src/generated/{manifest,catalog}.json，请先运行 npm run content:build')
  process.exit(1)
}
if (!fs.existsSync(DIST)) {
  console.error('[finalize] 找不到 dist/，请先运行 vite-ssg build')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as Catalog

/**
 * 「加载中…」的文案 —— 预渲染产物里**不该出现**它。
 *
 * 这是「预渲染出空壳」的一个真实形态：页面结构齐全、标题正确，但某些格子还停在
 * 装载态。它踩过一次：章节页只等基准列的分片，其余列在 SSG 同步渲染时还没到，
 * 于是预渲染出来的 HTML 里第二列往后全是「加载中…」—— 标题探针查不出来，
 * 线上表现是「爬虫与首屏都读不到对比内容」。
 *
 * `/search` 是**例外**：它的索引本来就在挂载后才加载，空输入框那页确实处于装载态。
 */
const LOADING_TEXT = (
  JSON.parse(fs.readFileSync(path.resolve('src/generated/i18n.json'), 'utf8')) as Record<
    string,
    unknown
  >
).loading as string | undefined

const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 路由 → 预渲染产物路径。与 vite.config.ts 的 ssgOptions.dirStyle = 'nested' 对应 */
function routeToHtml(route: string): string {
  if (route === '/') return path.join(DIST, 'index.html')
  return path.join(DIST, route.replace(/^\//, ''), 'index.html')
}

/**
 * 该 (基准, 板块) 下**预渲染实际采用**的方向。
 *
 * 与运行时 `resolvePairTarget` 同一套规则：优先默认对比语言，否则该板块第一个
 * 有内容的方向。探针必须跟着它走 —— 用 `manifest.pairs[0]`（按字母序的
 * `javascript--go`）去找首条陷阱，会对着讲 `javascript → python` 的页面
 * 报「找不到内容」。
 */
function pickPair(baseline: string, section: string) {
  const candidates = manifest.pairs.filter(
    (p) => p.baseline === baseline && p.sections.includes(section),
  )
  return candidates.find((p) => p.target === defaultCompareLanguageId) ?? candidates[0]
}

/**
 * 每条路由用来验证「内容确实被预渲染了」的探针文本。
 *
 * ⚠ 这里曾用 `/^\/compare\/([^/]+)\/([^/]+)$/` —— 那是旧版**两段地址**的形状，
 * 而章节路由是 4 段（`/compare/<基准>/<板块>/<章节>`）。结果是**所有 /compare 路由的
 * 验收都静默失效**（正则不匹配 → 返回 null → 跳过检查）。v2 把 feature 路由从 2 段
 * 改成 3 段时同理：**正则改漏一处，验收就悄悄不干活了**。
 */
function probeTextFor(route: string): string | null {
  // 章节型：/compare/<基准>/<板块>/<章节> —— 章节分类每个基准各一份，必须带基准查
  const chapter = /^\/compare\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(route)
  if (chapter) {
    const [, baseline, section, chapterId] = chapter
    const c = catalog.catalogs.find((x) => x.section === section && x.baseline === baseline)
    return c?.chapters.find((x) => x.id === chapterId)?.title ?? null
  }

  // 列表型：/compare/<基准>/<板块> —— 用该方向首条内容的标题做探针
  const list = /^\/compare\/([^/]+)\/([^/]+)$/.exec(route)
  if (list) {
    const [, baseline, section] = list
    const dataKey = manifest.sections.find((s) => s.id === section)?.dataKey
    const pair = pickPair(baseline!, section!)
    if (!pair || !dataKey) return null
    const shard = path.resolve(`src/generated/static/${pair.baseline}--${pair.target}.json`)
    if (!fs.existsSync(shard)) return null
    const payload = JSON.parse(fs.readFileSync(shard, 'utf8')) as Record<string, unknown>
    const items = payload[dataKey]
    const first = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined
    // 陷阱/路线用 title，词典用 term
    return (first?.title as string) ?? (first?.term as string) ?? null
  }

  // 特性页：/feature/<板块>/<feature> —— 全局 id 两段（与基准无关，章不在 id 里）
  const feature = /^\/feature\/([^/]+)\/([^/]+)$/.exec(route)
  if (feature) return catalog.featureIndex[`${feature[1]}/${feature[2]}`]?.title ?? null

  // 语言入口：/lang/<语言 id> —— 探针用语言名（页面 H1 就是它）
  const lang = /^\/lang\/([^/]+)$/.exec(route)
  if (lang) return getLanguageMeta(lang[1]!)?.name ?? null

  return null
}

/**
 * 这些路由**必须**有探针。
 *
 * 「探针查不到就跳过」是这条验收最危险的失效方式：正则跟着路由形状改漏一处，
 * 检查会静默不干活，而构建照样绿。所以对内容型路由改成**硬要求**：
 * 探针为 null 直接判失败，而不是跳过。
 *
 * `/` 不在其列：它是静态页，探针只能取到刚注入的 SEO 文案（自证），没有意义。
 */
const MUST_PROBE = /^\/(compare|feature|lang)\//

let failed = 0
let checked = 0
let probed = 0

/** 预渲染产出的全部路由，含不进 sitemap 的 /search —— 它们同样需要 title/canonical 收口 */
const allRoutes = [...manifest.routes, ...(manifest.prerenderExtra ?? [])]

for (const route of allRoutes) {
  const file = routeToHtml(route)
  if (!fs.existsSync(file)) {
    console.error(`  ✗ 缺少预渲染产物：${route} → ${path.relative(process.cwd(), file)}`)
    failed += 1
    continue
  }

  let html = fs.readFileSync(file, 'utf8')
  const seo = manifest.seo?.[route]

  if (seo?.title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(seo.title)}</title>`)
  }
  if (seo?.description) {
    if (/<meta name="description"/.test(html)) {
      html = html.replace(
        /<meta name="description"[^>]*>/,
        `<meta name="description" content="${esc(seo.description)}">`,
      )
    } else {
      html = html.replace(
        '</head>',
        `    <meta name="description" content="${esc(seo.description)}">\n  </head>`,
      )
    }
  }

  // canonical / og —— 只有配置了 PC_SITE_URL 才写，避免写入错误域名
  if (SITE_URL) {
    const canonical = `${SITE_URL}${BASE_PATH}${route === '/' ? '/' : route}`
    html = html.replace(
      '</head>',
      `    <link rel="canonical" href="${esc(canonical)}">\n` +
        `    <meta property="og:url" content="${esc(canonical)}">\n` +
        `    <meta property="og:title" content="${esc(seo?.title ?? '')}">\n` +
        `    <meta property="og:type" content="article">\n` +
        `  </head>`,
    )
  }

  fs.writeFileSync(file, html, 'utf8')

  /* 验收：HTML 里必须出现该页的内容文本（否则就是渲染出了空壳） */
  checked += 1
  const probe = probeTextFor(route)
  if (!probe) {
    if (MUST_PROBE.test(route)) {
      console.error(
        `  ✗ ${route} 取不到内容探针 —— 路由形状变了但 probeTextFor 没跟上，这条验收会静默失效`,
      )
      failed += 1
    }
  } else {
    probed += 1
    if (!html.includes(probe)) {
      console.error(`  ✗ ${route} 的预渲染 HTML 里找不到预期内容：「${probe}」`)
      failed += 1
    }
  }
  /*
   * 再看一眼「有没有格子还停在装载态」。标题探针只证明**页面**渲染了，
   * 证明不了**每一列**都渲染了 —— 后者要靠这条。
   */
  if (LOADING_TEXT && !route.startsWith('/search') && html.includes(`>${LOADING_TEXT}<`)) {
    console.error(`  ✗ ${route} 的预渲染 HTML 里还有「${LOADING_TEXT}」—— 有内容分片没在渲染前加载完`)
    failed += 1
  }
}

/* dist/404.html —— GitHub Pages 的唯一 SPA 回落手段 */
const indexHtml = path.join(DIST, 'index.html')
const notFound = path.join(DIST, '404.html')
if (fs.existsSync(indexHtml)) {
  let html = fs.readFileSync(indexHtml, 'utf8')
  if (!/<meta name="robots"/.test(html)) {
    html = html.replace('</head>', '    <meta name="robots" content="noindex, follow">\n  </head>')
  }
  fs.writeFileSync(notFound, html, 'utf8')
  console.log('[finalize] 已生成 dist/404.html（GH Pages 的 SPA 回落）')
} else {
  console.error('[finalize] 找不到 dist/index.html')
  failed += 1
}

console.log(
  `[finalize] 已处理 ${checked}/${allRoutes.length} 条路由的 title/description` +
    (SITE_URL ? `，并写入 canonical（${SITE_URL}${BASE_PATH}）` : '（未设置 PC_SITE_URL，跳过 canonical）'),
)
// 打印实际检查条数 —— 「检查了 0 条」与「全部通过」看起来是一样的，必须能区分
console.log(`[finalize] 其中 ${probed} 条做了内容探针检查（其余是静态页，无探针可查）`)

if (failed) {
  console.error(`[finalize] 失败 ${failed} 项 —— 预渲染不完整，SEO 目标未达成。`)
  process.exit(1)
}
console.log('[finalize] 预渲染验收通过：每条路由的 HTML 都含该页真实内容。')
