/**
 * 在一段文本里找出「语言指称」的位置。
 *
 * 用途：`verify:ext` 的第三道断言 —— 面向用户的文案（i18n 的值、`.vue` 的 `<template>` 段）
 * 不许把某一门语言写死。三门基准权重相同，写死任何一门都会让另外两门的页面说谎
 * （`PitfallCard` 的徽章曾硬编码「JS 开发者必踩」，于是 java2python 页面上也在讲 JS）。
 *
 * 曾经的另一半用途 —— 校验「基准列的注记 / `vs.<基准>` 的说明只讲屏幕上那几门语言」
 * （编号 R25「幽灵语言」）—— 已随 ADR-72 废除，配套的 `detectForeignLanguageMentions`
 * 与同族豁免判据一并删除。
 */
import type { LanguageMeta } from '../../src/schemas'

/** 正则元字符转义（别名里可能含 `.` 等） */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 构造「指称某门语言」的匹配正则。大小写敏感 + 显式 ASCII 边界，
 * 这样 `Go` 不会撞上英文动词 `go`，`Java` 不会被 `JavaScript` 前缀命中
 * （`Java` 后跟 `S` 是单词字符，边界断言失败 → 不匹配）；中文紧邻也能命中
 * （`用Python写` —— 显式字符类而非依赖 ASCII `\w` 的 `\b`）。
 */
export function languageMentionRe(word: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(word)}(?![A-Za-z0-9_])`)
}

/**
 * 收集「可以作为语言指称的词」。
 *
 * 别名只收长度 ≥ 3 的：`js` / `es` / `rs` / `py` 这类两字母别名在技术文本里误报率太高
 * （`.js` 文件扩展名、英文缩写），而 shortName 已经覆盖了它们最常见的写法。
 */
function candidateWords(langs: LanguageMeta[]): { word: string; lang: LanguageMeta }[] {
  const out: { word: string; lang: LanguageMeta }[] = []
  const seen = new Set<string>()
  for (const l of langs) {
    for (const w of [l.name, l.shortName, ...l.aliases.filter((a) => a.length >= 3)]) {
      // 去重：name 与 shortName 常常同形（Go / Java / Rust 都是），不去重会同一行报两次
      if (!w || w.length < 2 || seen.has(w)) continue
      seen.add(w)
      out.push({ word: w, lang: l })
    }
  }
  return out
}

/**
 * 在一段**任意文本**里找语言指称词（不排除任何一门）。
 *
 * 问的是「这段面向用户的文案有没有把某一门语言写死」—— 三门基准权重相同，
 * 写死任何一门都会让另外两门的页面说谎（`PitfallCard` 的徽章曾硬编码
 * 「JS 开发者必踩」，于是 java2python 页面上也在讲 JS）。
 */
export function findLanguageWords(
  text: string,
  langs: LanguageMeta[],
): { word: string; langId: string }[] {
  const out: { word: string; langId: string }[] = []
  for (const { word, lang } of candidateWords(langs)) {
    if (languageMentionRe(word).test(text)) out.push({ word, langId: lang.id })
  }
  return out
}
