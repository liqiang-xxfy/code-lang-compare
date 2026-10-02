import { describe, expect, it } from 'vitest'
import { extractNotes } from '../../scripts/lib/core'

describe('extractNotes —— 内联 @note 抽取（ADR-10）', () => {
  /*
   * 契约：
   *   · 两种语气的说明都**留在代码行内**，贴着那一行读，不另设说明栏
   *   · 高危 @note! 的差别只是说明前多一个 `⚠`，注释正文保持原样
   * allNotes 始终收录全部注记（info + warn），供搜索索引与构建期校验使用；
   * notes 只收高危项，作为结构化副本。
   */

  it('普通标记：说明留在代码注释里，不进 notes', () => {
    const { code, notes, allNotes } = extractNotes(
      'let count = 0;          // @note 块级作用域，可重新赋值',
      '//',
    )
    expect(code).toBe('let count = 0;          // 块级作用域，可重新赋值')
    expect(notes).toEqual([])
    expect(allNotes).toEqual([{ line: 1, text: '块级作用域，可重新赋值', tone: 'info' }])
  })

  it('普通标记 + 注释另有正文：两者合并，说明不会凭空消失', () => {
    // 旧实现用 `kept || text` 会把说明顶掉，而它又不在 notes 里 —— 两个出口都不出现
    const { code, notes, allNotes } = extractNotes(
      'doThing();     // 幂等 —— @note 重复调用不会出问题',
      '//',
    )
    expect(code).toBe('doThing();     // 幂等 —— 重复调用不会出问题')
    expect(notes).toEqual([])
    expect(allNotes[0]!.text).toBe('重复调用不会出问题')
  })

  it('高危标记：说明同样留在行内，只在说明前多一个 ⚠', () => {
    const { code, notes, allNotes } = extractNotes(
      'Boolean([]);     // true  —— @note! 空数组是真值',
      '//',
    )
    expect(code).toBe('Boolean([]);     // true —— ⚠ 空数组是真值')
    expect(notes).toEqual([{ line: 1, text: '空数组是真值', tone: 'warn' }])
    expect(allNotes).toEqual(notes)
  })

  it('高危标记独占整行：整行变成带 ⚠ 的注释，行数不变', () => {
    const { code, notes } = extractNotes('var legacy = 1;\n// @note! 函数作用域且会提升', '//')
    expect(code).toBe('var legacy = 1;\n// ⚠ 函数作用域且会提升')
    expect(notes).toEqual([{ line: 2, text: '函数作用域且会提升', tone: 'warn' }])
  })

  it('普通与高危在代码里的差别只有 ⚠ —— 其余一字不差', () => {
    const plain = extractNotes('f();  // 正文 —— @note 说明', '//').code
    const warn = extractNotes('f();  // 正文 —— @note! 说明', '//').code
    expect(warn).toBe(plain.replace('—— 说明', '—— ⚠ 说明'))
  })

  it('高危但说明为空：不落单一个 ⚠（R4 已就「说明为空」报警）', () => {
    const { code, notes } = extractNotes('let a = 1;  // @note!  ', '//')
    expect(code).toBe('let a = 1;  //')
    expect(notes).toEqual([{ line: 1, text: '', tone: 'warn' }])
  })

  it('行数恒定 —— 注记行与行级 diff 靠它对位', () => {
    const raw = '// @note! 首行就是高危\nlet a = 1;\n// @note! 第三条'
    expect(extractNotes(raw, '//').code.split('\n')).toHaveLength(3)
  })

  it('尊重该语言自己的注释前缀（Python 用 #）', () => {
    const { code, notes } = extractNotes('count = 0            # @note 赋值即声明', '#')
    expect(code).toBe('count = 0            # 赋值即声明')
    expect(notes).toHaveLength(0)
  })

  it('注释前缀不匹配时不动它（交给 R4/R9 报错，而不是静默吞掉）', () => {
    const raw = 'let a = 1;  // @note 用 JS 注释符写的标记'
    expect(extractNotes(raw, '#').allNotes).toHaveLength(0)
    expect(extractNotes(raw, '#').code).toBe(raw)
  })

  it('行号按原始代码计（用于界面上的 L<n> 定位）', () => {
    const raw = ['const a = 1;', 'const b = 2;  // @note! 第二条', 'const c = 3;'].join('\n')
    expect(extractNotes(raw, '//').notes[0]!.line).toBe(2)
  })

  it('没有标记时原样返回', () => {
    const raw = 'const a = 1;  // 普通注释'
    expect(extractNotes(raw, '//')).toEqual({ code: raw, notes: [], allNotes: [] })
  })

  it('去掉首尾空行（YAML 块标量常带尾随换行）', () => {
    expect(extractNotes('\ncode();\n\n', '//').code).toBe('code();')
  })

  it('allNotes 收录两个语气，notes 只收高危', () => {
    const { notes, allNotes } = extractNotes('a();  // @note 普通\nb();  // @note! 高危', '//')
    expect(allNotes.map((n) => n.tone)).toEqual(['info', 'warn'])
    expect(notes.map((n) => n.tone)).toEqual(['warn'])
    expect(notes[0]!.line).toBe(2)
  })
})
