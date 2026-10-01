/**
 * 极简 i18n —— 只覆盖「界面 chrome 与领域词汇」（架构定稿 §9.4）。
 *
 * 内容本身（Feature 标题、snippet 说明、踩坑文案）不做多语言，这是刻意的：
 * 内容 i18n 的成本 ≈ 全部内容工作量 × 语言数，属于长期非目标。
 */
import { i18nMessages } from '@/content/repository'

function lookup(path: string): string | undefined {
  let cur: unknown = i18nMessages
  for (const seg of path.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return typeof cur === 'string' ? cur : undefined
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let out = lookup(key) ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  }
  return out
}

export function useI18n() {
  return { t }
}
