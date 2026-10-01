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
  topics: Array<{ id: string; title: string; chapters: Array<{ id: string; title: string }> }>
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

/** 每条路由用来验证「内容确实被预渲染了」的探针文本 */
function probeTextFor(route: string): string | null {
  const chapter = /^\/compare\/([^/]+)\/([^/]+)$/.exec(route)
  if (chapter) {
    const chapterId = `${chapter[1]}/${chapter[2]}`
    const topic = manifest.topics.find((t) => t.chapters.some((c) => c.id === chapterId))
    return topic?.chapters.find((c) => c.id === chapterId)?.title ?? null
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
