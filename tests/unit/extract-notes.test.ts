import { describe, expect, it } from 'vitest'
import { extractNotes } from '../../scripts/lib/core'

describe('extractNotes —— 内联 @note 抽取（ADR-10）', () => {
  it('标记即注释内容时：剥离标记，用说明文本作为注释正文', () => {
    const { code, notes } = extractNotes('let count = 0;          // @note 块级作用域，可重新赋值', '//')
    expect(code).toBe('let count = 0;          // 块级作用域，可重新赋值')
    expect(notes).toEqual([{ line: 1, text: '块级作用域，可重新赋值', tone: 'info' }])
  })

  it('注释另有正文时：保留正文，清掉连接符不留下「——」残尾', () => {
    const { code, notes } = extractNotes('Boolean([]);     // true  —— @note! 空数组是真值', '//')
    expect(code).toBe('Boolean([]);     // true')
    expect(notes).toEqual([{ line: 1, text: '空数组是真值', tone: 'warn' }])
  })

  it('尊重该语言自己的注释前缀（Python 用 #）', () => {
    const { code, notes } = extractNotes('count = 0            # @note 赋值即声明', '#')
    expect(code).toBe('count = 0            # 赋值即声明')
    expect(notes).toHaveLength(1)
  })

  it('注释前缀不匹配时不动它（交给 R4/R9 报错，而不是静默吞掉）', () => {
    const raw = 'let a = 1;  // @note 用 JS 注释符写的标记'
    expect(extractNotes(raw, '#').notes).toHaveLength(0)
    expect(extractNotes(raw, '#').code).toBe(raw)
  })

  it('行号按原始代码计（用于界面上的 L<n> 定位）', () => {
    const raw = ['const a = 1;', 'const b = 2;  // @note 第二条', 'const c = 3;'].join('\n')
    expect(extractNotes(raw, '//').notes[0]!.line).toBe(2)
  })

  it('没有标记时原样返回', () => {
    const raw = 'const a = 1;  // 普通注释'
    expect(extractNotes(raw, '//')).toEqual({ code: raw, notes: [] })
  })

  it('去掉首尾空行（YAML 块标量常带尾随换行）', () => {
    expect(extractNotes('\ncode();\n\n', '//').code).toBe('code();')
  })
})
