/**
 * 检测注记文本里点名了哪些语言。
 *
 * 用途：校验「基准列的注记只讲基准语言自己」。基准列是这一页的参照系，
 * 它的注记去讲别的语言，会把读者引向屏幕上并不存在的一列 —— basics 是多选列，
 * 勾 Java+Go+Rust 时读到一句讲 Python 的注记，就是所谓的幽灵语言。
 */
import type { Annotation, LanguageMeta } from '../../src/schemas'

export interface ForeignMention {
  /** 注记所在行（原始行号，与界面上的 L{n} 同源） */
  line: number
  /** 命中的那个词，用于排查误报 */
  word: string
  langId: string
  /** 被点名语言的显示名 */
  name: string
}

/** 正则元字符转义（别名里可能含 `.` 等） */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 构造「指称某门语言」的匹配正则。大小写敏感 + 显式 ASCII 边界，
 * 理由见 `detectForeignLanguageMentions` 的注释（`Go` 不撞英文动词、`Java` 不被 `JavaScript` 命中）。
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
function candidateWords(
  langs: LanguageMeta[],
  selfLangId?: string,
): { word: string; lang: LanguageMeta }[] {
  const out: { word: string; lang: LanguageMeta }[] = []
  const seen = new Set<string>()
  for (const l of langs) {
    if (l.id === selfLangId) continue
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
 * 找出注记里点名了「非 selfLangId 语言」的位置。
 *
 * 匹配刻意**大小写敏感**：内容里语言名首字母大写，这样 `Go` 不会撞上英文动词 `go`。
 * 边界用显式 ASCII 字符类而非 `\b` —— 注记是中文，`\b` 依赖 ASCII `\w`，
 * 在「用Python写」这类中文紧邻的场景下行为不可预期。两侧的边界断言同时解决了
 * `Java` 被 `JavaScript` 前缀命中（`Java` 后跟 `S` 是单词字符，断言失败 → 不匹配）。
 */
export function detectForeignLanguageMentions(
  notes: Annotation[],
  selfLangId: string,
  langs: LanguageMeta[],
): ForeignMention[] {
  const words = candidateWords(langs, selfLangId)
  const out: ForeignMention[] = []

  for (const note of notes) {
    for (const { word, lang } of words) {
      if (languageMentionRe(word).test(note.text)) {
        out.push({ line: note.line, word, langId: lang.id, name: lang.name })
      }
    }
  }
  return out
}

/**
 * 由「指称同族组」算出每门语言的同族集合（不含自己）。
 *
 * R25 问的是「这一格的说明讲了屏幕外的语言吗」。同族语言是这条规则的**唯一例外**，
 * 理由见 `content/registry.yaml` 的 `mentionGroups` 段：JavaScript 与 TypeScript
 * 在读者眼里是同一套生态的两面，讲其中一门时提到另一门，不是屏幕上冒出来的第三门，
 * 而是那一列本身的两个层次。
 */
export function kindredIds(groups: string[][]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const group of groups) {
    for (const id of group) {
      let set = out.get(id)
      if (!set) {
        set = new Set()
        out.set(id, set)
      }
      for (const other of group) if (other !== id) set.add(other)
    }
  }
  return out
}

/**
 * R25 的例外判据：`m` 出现在「本语言 selfId、该格面对的基准 baseId」这一格时，
 * 算不算「屏幕外」。
 *
 * 判据按**两门**算，不是只看本语言 —— 一格的说明描述的是**那一列**：
 * `vs.javascript` 讲的就是 JavaScript 那一列，读者从哪门语言进来都一样。
 * 于是「JavaScript 自己不做静态检查，要靠 TypeScript」写在以 Python 为基准的
 * JavaScript 列里，提的仍是那一列自己的两个层次，不该被报成幽灵语言。
 */
export function isKindredMention(
  m: string,
  selfId: string,
  baseId: string | null,
  kindred: Map<string, Set<string>>,
): boolean {
  return (
    (kindred.get(selfId)?.has(m) ?? false) || (baseId !== null && (kindred.get(baseId)?.has(m) ?? false))
  )
}

/**
 * 在一段**任意文本**里找语言指称词（不排除任何一门）。
 *
 * 用途与 R12 相反：R12 问「这条注记有没有讲屏幕外的语言」，这里问
 * 「这段面向用户的文案有没有把某一门语言写死」—— 三门基准权重相同，
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
