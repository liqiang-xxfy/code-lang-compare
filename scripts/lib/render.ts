/**
 * 构建期渲染：Markdown（受限白名单）+ Shiki 预高亮。
 *
 * 关键决策：
 *  · 高亮在构建期完成，Shiki 是 devDependency，不进客户端包（ADR-04）
 *  · 首选 Shiki 的 `css-variables` 主题 → 一份 HTML 即可明暗切换，产物体积减半
 *  · 若该主题在本机不可用，自动降级为双主题输出（ADR-04 的降级路径，会在构建日志里显式告知）
 *  · Markdown 关闭裸 HTML（html:false）——LLM 产出 → 渲染是一条真实的注入路径（ADR-09/ADR-15）
 */
import MarkdownIt from 'markdown-it'
import { createHighlighter, type Highlighter } from 'shiki'
import { createCssVariablesTheme } from 'shiki/core'

export type HighlightMode = 'css-variables' | 'dual'

/**
 * css-variables 主题：一份 HTML，明暗靠 CSS 变量切换（ADR-04）。
 *
 * 注意 shiki v1 的默认 bundle **不含**这个主题，必须显式创建后注册。
 *
 * 【Q5 实测结论（2026-10-01）】
 *   该主题只输出颜色（`style="color:var(--shiki-token-comment)"`），
 *   **不输出 font-style / font-weight** —— 注释的斜体、关键字的粗体全部丢失。
 *   shiki v1 的 createCssVariablesTheme 也不接受 fontStyle 选项。
 *
 *   处置：不放弃该主题，而是在 CSS 侧按 token 变量名补偿（产物仍是单份 HTML）：
 *     src/styles/base.css
 *       .pc-code pre.shiki span[style*='--shiki-token-comment'] { font-style: italic }
 *       .pc-code pre.shiki span[style*='--shiki-token-keyword'] { font-weight: 600 }
 *   如果哪天这套补偿失效，resolveHighlightMode() 会实测出结果并自动降级为双主题输出。
 */
export const CSS_VARIABLES_THEME_NAME = 'css-variables'

const cssVariablesTheme = createCssVariablesTheme({
  name: CSS_VARIABLES_THEME_NAME,
  variablePrefix: '--shiki-',
  // 不给 variableDefaults：所有 --shiki-* 变量都由我们自己在 tokens.css 里定义，
  // 让 shiki 再写一遍默认值只会把产物变大。
})

let hl: Highlighter | null = null
let mode: HighlightMode | null = null

export async function initHighlighter(langs: string[]): Promise<void> {
  if (hl) return
  const wanted = [...new Set(langs.filter(Boolean))]
  try {
    hl = await createHighlighter({
      themes: [cssVariablesTheme, 'github-light', 'github-dark'],
      langs: wanted.length ? wanted : ['text'],
    })
  } catch (e) {
    // 连主题都注册不了 → 直接走双主题路径
    console.warn(`[highlight] 初始化失败，降级为双主题：${(e as Error).message}`)
    mode = 'dual'
    hl = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: wanted.length ? wanted : ['text'],
    })
  }
}

export async function resolveHighlightMode(): Promise<HighlightMode> {
  if (mode) return mode
  if (!hl) throw new Error('initHighlighter() 必须先于 resolveHighlightMode() 调用')
  try {
    const html = hl.codeToHtml('const a = 1', {
      lang: 'javascript',
      theme: CSS_VARIABLES_THEME_NAME,
    })
    mode = html.includes('--shiki-') ? 'css-variables' : 'dual'
  } catch (e) {
    console.warn(`[highlight] css-variables 不可用，降级为双主题输出：${(e as Error).message}`)
    mode = 'dual'
  }
  return mode
}

export interface Highlighted {
  html: string
  htmlDark?: string
  lineCount: number
}

export function highlightSync(
  code: string,
  lang: string,
  highlightMode: HighlightMode,
): Highlighted {
  if (!hl) throw new Error('initHighlighter() 必须先于 highlightSync() 调用')
  if (code.length === 0) return { html: '', lineCount: 0 }

  const lineCount = code.split('\n').length
  const safeLang = hl.getLoadedLanguages().includes(lang) ? lang : 'text'

  if (highlightMode === 'css-variables') {
    return {
      html: hl.codeToHtml(code, { lang: safeLang, theme: CSS_VARIABLES_THEME_NAME }),
      lineCount,
    }
  }
  return {
    html: hl.codeToHtml(code, { lang: safeLang, theme: 'github-light' }),
    htmlDark: hl.codeToHtml(code, { lang: safeLang, theme: 'github-dark' }),
    lineCount,
  }
}

/* ────────────────────────── Markdown ────────────────────────── */

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    // 安全边界：禁止内容里的裸 HTML。LLM 产出 → 渲染是一条真实的注入路径。
    html: false,
    linkify: false,
    breaks: false,
  })

  // 只放行安全协议，挡掉 javascript: / data:
  md.validateLink = (url: string) => /^(https?:|mailto:|#|\/)/i.test(url.trim())

  // 外链加 rel，避免把权重与 window.opener 交出去
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx]?.attrGet('href') ?? ''
    if (/^https?:/i.test(href)) {
      tokens[idx]?.attrSet('target', '_blank')
      tokens[idx]?.attrSet('rel', 'noopener noreferrer')
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return md
}

/**
 * 渲染受限 Markdown。
 *
 * 两遍：先解析出所有 fenced code，异步高亮（Shiki 是同步 API 但需要先 init），
 * 再让 markdown-it 通过 highlight 钩子取用——这样正文里的代码块与矩阵里的代码块
 * 走的是同一套高亮，不会出现两种配色。
 */
export function renderMarkdown(
  md: MarkdownIt,
  text: string | undefined,
  highlightMode: HighlightMode,
  fallbackLang = 'text',
): string {
  if (!text || !text.trim()) return ''

  const tokens = md.parse(text, {})
  const cache = new Map<string, string>()

  for (const t of tokens) {
    if (t.type !== 'fence') continue
    const lang = (t.info.trim().split(/\s+/)[0] || fallbackLang).toLowerCase()
    const key = `${lang}\u0000${t.content}`
    if (cache.has(key)) continue
    try {
      cache.set(key, highlightSync(t.content.replace(/\n$/, ''), lang, highlightMode).html)
    } catch {
      cache.set(key, '')
    }
  }

  md.options.highlight = (code, lang) => cache.get(`${(lang || fallbackLang).toLowerCase()}\u0000${code}`) ?? ''

  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens2, idx, options, env, self) => {
    const t = tokens2[idx]!
    const lang = (t.info.trim().split(/\s+/)[0] || fallbackLang).toLowerCase()
    const rendered = options.highlight?.(t.content, lang, '') ?? ''
    // Shiki 的输出自带 <pre>，直接透出，避免被 markdown-it 再包一层
    if (rendered.startsWith('<pre')) return rendered + '\n'
    return defaultFence(tokens2, idx, options, env, self)
  }

  return md.renderer.render(tokens, md.options, {})
}
