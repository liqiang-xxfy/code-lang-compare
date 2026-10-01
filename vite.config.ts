import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolveBasePath } from './scripts/lib/env-paths'

const { value: base, warning: baseWarning } = resolveBasePath()
if (baseWarning) console.warn(`[vite] ${baseWarning}`)

/**
 * base 路径：本地 dev / preview 用 '/'（默认）；GitHub Pages 项目页用 '/<repo-name>/'。
 *
 * 部署时注入：PC_BASE_PATH=code-lang-compare PC_SITE_URL=https://<user>.github.io npm run build
 * （注意 PC_BASE_PATH **不带前导斜杠**，原因见 scripts/lib/env-paths.ts 的说明）
 *
 * 注意：router 的 base 取自 import.meta.env.BASE_URL（即这里配的 base）。
 * 两者不一致会导致「本地正常、部署后所有资源与深链 404」——本类项目的头号部署陷阱。
 */

/**
 * 预渲染路由清单 —— 直接读构建期产出的 manifest.json。
 *
 * 关键点：可索引路由由 manifest 单点定义，vite-ssg 的预渲染与 sitemap.xml 共用同一份，
 * 因此不可能出现「sitemap 里有但没预渲染」这种不一致（架构定稿 §9.5 的验收条件）。
 *
 * `prerenderExtra` 是**预渲染但不进 sitemap** 的那部分（`/search`）——
 * 它对爬虫无价值，但用户会深链访问，所以要出静态外壳。
 */
function prerenderRoutes(): string[] {
  const manifestPath = path.resolve(process.cwd(), 'src/generated/manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.warn(
      '[vite] 未找到 src/generated/manifest.json —— 预渲染只会产出首页。请先运行 npm run content:build',
    )
    return ['/']
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    routes?: string[]
    prerenderExtra?: string[]
  }
  const all = [...(manifest.routes ?? []), ...(manifest.prerenderExtra ?? [])]
  return all.length ? all : ['/']
}

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // 预渲染 HTML + 内容分片会让产物偏大，这是预期内的
    chunkSizeWarningLimit: 900,
  },
  ssgOptions: {
    /**
     * nested：/foo → /foo/index.html
     *
     * 这一项**必须**是 nested。默认的 flat 会产出 /foo.html，
     * 而 GitHub Pages 不做「无扩展名 → .html」的解析，
     * 结果就是所有深链 404（只有首页能打开）。这是 P0 阶段最容易漏掉的一条。
     */
    dirStyle: 'nested',
    includeAllRoutes: false,
    includedRoutes: () => prerenderRoutes(),
    // beasties 是可选的 peer 依赖，用于内联关键 CSS；我们不装它，也就显式关掉
    beastiesOptions: false,
    formatting: 'none',
    concurrency: 20,
  },
})
