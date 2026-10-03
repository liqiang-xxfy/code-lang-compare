import { describe, expect, it } from 'vitest'
import { findLanguageWords } from '../../scripts/lib/lang-mention'
import type { LanguageMeta } from '../../src/schemas'

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

describe('findLanguageWords —— 文案里写死的语言名（verify:ext 第三道断言）', () => {
  const find = (text: string) => findLanguageWords(text, LANGS).map((h) => h.langId)

  it('命中的正是当初漏出去的那句硬编码', () => {
    // PitfallCard 的徽章曾写死「JS 开发者必踩」，于是 java2python 页面上也在讲 JS
    expect(find('JS 开发者必踩')).toEqual(['javascript'])
    expect(find('Python 开发者必踩')).toEqual(['python'])
  })

  it('不排除任何一门 —— 这里要的就是「整段文本讲了谁」', () => {
    expect(find('JavaScript / Python / Java').sort()).toEqual(['java', 'javascript', 'python'])
  })

  it('占位符写法不报（这正是应该有的写法）', () => {
    expect(find('{baseline} 开发者必踩')).toEqual([])
    expect(find('以 {name} 为基准')).toEqual([])
  })

  it('沿用边界规则：Java 不被 JavaScript 前缀命中', () => {
    expect(find('JavaScript 的坑')).toEqual(['javascript'])
  })

  it('大小写敏感挡住的是小写英文动词，挡不住句首大写的 Go', () => {
    expect(find('go to settings')).toEqual([])
    expect(find('用 Go 写服务')).toEqual(['go'])
    // 句首大写的英文 Go 与语言名同形，两种用途分不开 —— 这是检测器的已知代价。
    // 文案里真要写英文句子，换个说法即可（扫描器不猜语义）。
    expect(find('Go to settings')).toEqual(['go'])
  })

  it('两字母别名同样不参与（.js 后缀不是语言点名）', () => {
    expect(find('配置文件是 .js 后缀')).toEqual([])
  })
})
