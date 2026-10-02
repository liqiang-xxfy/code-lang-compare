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
import { defaultCompareLanguageId } from '../../src/generated/registry.gen'
import { resolveBasePath, resolveSiteUrl } from '../lib/env-paths'

const DIST = path.resolve('dist')
const MANIFEST_PATH = path.resolve('src/generated/manifest.json')

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
  topics: Array<{
    id: string
    title: string
    section: string
    baseline: string
    target?: string
    chapters: Array<{ id: string; title: string }>
  }>
  pairs: Array<{ baseline: string; target: string; sections: string[] }>
  sections: Array<{ id: string; shape: string; scope: string; dataKey?: string }>
  featureIndex: Record<string, { title: string; chapterId: string; topicId: string }>
}

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('[finalize] 找不到 src/generated/manifest.json，请先运行 npm run content:build')
  process.exit(1)
}
if (!fs.existsSync(DIST)) {
  console.error('[finalize] 找不到 dist/，请先运行 vite-ssg build')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest

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
 * ⚠ 这里曾用 `/^\/compare\/([^/]+)\/([^/]+)$/` —— 那是 P7 之前**两段旧地址**的形状，
 * 而现在的章节路由是 4 段（`/compare/<基准>/<板块>/<章节 slug>`）。
 * 结果是**所有 /compare 路由的验收都静默失效**（正则不匹配 → 返回 null → 跳过检查），
 * 只有 /feature 那几条还在真正工作。也就是说「空壳预渲染会在这里失败」这句话，
 * 对板块页一直没有兑现。
 */
function probeTextFor(route: string): string | null {
  // 章节型：/compare/<基准>/<板块>/<章节 slug>
  const chapter = /^\/compare\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(route)
  if (chapter) {
    const [, baseline, section, slug] = chapter
    const def = manifest.sections.find((s) => s.id === section)
    if (!def) return null
    /*
     * 对级板块必须连 target 一起匹配 —— 多个方向会有同名 slug（`01-functions` 到处都是），
     * 而预渲染出来的那一页只讲**默认方向**（与运行时 resolvePairTarget 同规则）。
     */
    const target = def.scope === 'pair' ? pickPair(baseline!, section!)?.target : undefined
    const topic = manifest.topics.find(
      (t) =>
        t.baseline === baseline &&
        t.section === section &&
        (def.scope !== 'pair' || t.target === target),
    )
    return topic?.chapters.find((c) => c.id.split('/')[1] === slug)?.title ?? null
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

  const feature = /^\/feature\/([^/]+)\/([^/]+)$/.exec(route)
  if (feature) return manifest.featureIndex[`${feature[1]}/${feature[2]}`]?.title ?? null
  return null
}

let failed = 0
let checked = 0

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
  if (probe && !html.includes(probe)) {
    console.error(`  ✗ ${route} 的预渲染 HTML 里找不到预期内容：「${probe}」`)
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

if (failed) {
  console.error(`[finalize] 失败 ${failed} 项 —— 预渲染不完整，SEO 目标未达成。`)
  process.exit(1)
}
console.log('[finalize] 预渲染验收通过：每条路由的 HTML 都含该页真实内容。')
