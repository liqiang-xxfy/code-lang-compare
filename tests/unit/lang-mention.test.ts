import { describe, expect, it } from 'vitest'
import {
  detectForeignLanguageMentions,
  findLanguageWords,
  isKindredMention,
  kindredIds,
} from '../../scripts/lib/lang-mention'
import type { Annotation, LanguageMeta } from '../../src/schemas'

const lang = (id: string, name: string, shortName: string, aliases: string[] = []): LanguageMeta =>
  ({ id, name, shortName, aliases }) as LanguageMeta

// 与 content/languages/*/meta.yaml 的 name / shortName / aliases 一致
const LANGS = [
  lang('javascript', 'JavaScript', 'JS', ['js', 'ecmascript', 'es']),
  lang('java', 'Java', 'Java', ['jdk', 'jvm', 'java21']),
  lang('python', 'Python', 'Py', ['py', 'python3', 'cpython']),
  lang('go', 'Go', 'Go', ['golang']),
  lang('rust', 'Rust', 'Rust', ['rs', 'rustlang']),
]

const detect = (text: string, self = 'javascript') =>
  detectForeignLanguageMentions([{ line: 1, text, tone: 'info' } as Annotation], self, LANGS)

describe('detectForeignLanguageMentions —— 基准列的语言点名检测（R12）', () => {
  it('JavaScript 不会被 Java 前缀命中', () => {
    expect(detect('JavaScript 的 var 是函数作用域', 'python').map((h) => h.langId)).toEqual([
      'javascript',
    ])
  })

  it('中文紧邻时也能命中（用显式字符类而非 \\b）', () => {
    expect(detect('用Python写').map((h) => h.langId)).toEqual(['python'])
  })

  it('排除本语言自己', () => {
    expect(detect('JavaScript 里 let 是块级作用域')).toEqual([])
  })

  it('name 与 shortName 同形时只报一次', () => {
    // Go / Java / Rust 的 name 与 shortName 完全相同，不去重会同一行报两条
    expect(detect('Go 的整数溢出是静默回绕').length).toBe(1)
  })

  it('大小写敏感：Go 不撞英文动词 go，也不撞 Google', () => {
    expect(detect('you can go there later')).toEqual([])
    expect(detect('Google 了一下')).toEqual([])
  })

  it('别名可命中（golang / python3）', () => {
    expect(detect('golang 里没有异常').map((h) => h.langId)).toEqual(['go'])
    expect(detect('python3 的规则').map((h) => h.langId)).toEqual(['python'])
  })

  it('两字母别名不参与匹配（.js 扩展名不该被当成语言点名）', () => {
    expect(detect('配置文件是 .js 后缀', 'python')).toEqual([])
  })

  it('一行点名多门语言会各报一条', () => {
    expect(detect('像 Java 或 Rust 那样').map((h) => h.langId).sort()).toEqual(['java', 'rust'])
  })

  it('行号沿用注记的原始行号（与界面上的 L{n} 同源）', () => {
    const notes: Annotation[] = [
      { line: 3, text: '普通说明', tone: 'info' },
      { line: 7, text: 'Python 没有这个', tone: 'warn' },
    ]
    expect(detectForeignLanguageMentions(notes, 'javascript', LANGS)[0]!.line).toBe(7)
  })
})

describe('findLanguageWords —— 文案里写死的语言名（verify:ext 第三道断言）', () => {
  const find = (text: string) => findLanguageWords(text, LANGS).map((h) => h.langId)

  it('命中的正是当初漏出去的那句硬编码', () => {
    // PitfallCard 的徽章曾写死「JS 开发者必踩」，于是 java2python 页面上也在讲 JS
    expect(find('JS 开发者必踩')).toEqual(['javascript'])
    expect(find('Python 开发者必踩')).toEqual(['python'])
  })

  it('不排除任何一门 —— 与 R12 相反，这里要的就是「整段文本讲了谁」', () => {
    expect(find('JavaScript / Python / Java').sort()).toEqual(['java', 'javascript', 'python'])
  })

  it('占位符写法不报（这正是应该有的写法）', () => {
    expect(find('{baseline} 开发者必踩')).toEqual([])
    expect(find('以 {name} 为基准')).toEqual([])
  })

  it('沿用 R12 的边界规则：Java 不被 JavaScript 前缀命中', () => {
    expect(find('JavaScript 的坑')).toEqual(['javascript'])
  })

  it('大小写敏感挡住的是小写英文动词，挡不住句首大写的 Go', () => {
    expect(find('go to settings')).toEqual([])
    expect(find('用 Go 写服务')).toEqual(['go'])
    // 句首大写的英文 Go 与语言名同形，两种用途分不开 —— 这是共用 R12 检测器的已知代价。
    // 文案里真要写英文句子，换个说法即可（扫描器不猜语义）。
    expect(find('Go to settings')).toEqual(['go'])
  })

  it('两字母别名同样不参与（.js 后缀不是语言点名）', () => {
    expect(find('配置文件是 .js 后缀')).toEqual([])
  })
})

describe('kindredIds / isKindredMention —— R25 的同族豁免（ADR-71）', () => {
  const kindred = kindredIds([['javascript', 'typescript']])

  it('同族关系是**互相**的，且不含自己', () => {
    expect([...kindred.get('javascript')!]).toEqual(['typescript'])
    expect([...kindred.get('typescript')!]).toEqual(['javascript'])
    expect(kindred.get('javascript')!.has('javascript')).toBe(false)
    expect(kindred.get('python')).toBeUndefined()
  })

  it('没有声明任何组时是空表 —— 豁免默认关闭', () => {
    expect(kindredIds([]).size).toBe(0)
  })

  it('判据按**两门**算：本语言同族，或该格面对的基准同族', () => {
    // JavaScript 列说自己要靠 TypeScript（读者以 Python 为基准）
    expect(isKindredMention('typescript', 'python', 'javascript', kindred)).toBe(true)
    // JavaScript 基准列自己提到 TypeScript
    expect(isKindredMention('typescript', 'javascript', null, kindred)).toBe(true)
    // TypeScript 列反过来提 JavaScript
    expect(isKindredMention('javascript', 'typescript', 'java', kindred)).toBe(true)
  })

  it('两门都不沾 JS 家族的格子照常拦截', () => {
    expect(isKindredMention('typescript', 'go', 'python', kindred)).toBe(false)
    expect(isKindredMention('typescript', 'go', null, kindred)).toBe(false)
    // 被点名的不是同族，也不是自己或基准
    expect(isKindredMention('python', 'javascript', 'java', kindred)).toBe(false)
  })

  it('ArkTS 刻意不在同族里 —— 它不是 JavaScript 的超集，是独立的语言', () => {
    expect(isKindredMention('arkts', 'javascript', 'python', kindred)).toBe(false)
    expect(isKindredMention('javascript', 'arkts', null, kindred)).toBe(false)
  })
})
