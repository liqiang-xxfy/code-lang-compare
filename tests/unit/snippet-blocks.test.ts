/**
 * 多段对照代码（`blocks`）的契约与逐段 diff。
 *
 * 两件事要钉住：
 *  1. R16 —— `code` 与 `blocks` 恰好给一个，且多段的每一段都必须有 label
 *  2. 逐段 diff —— 各段各有自己的行号空间；段数不一致时必须拒绝，
 *     而不是把各段拼起来算出一份行号对不上任何一段的着色
 */
import { describe, expect, it } from 'vitest'
import { compareBlockArrays } from '../../src/content/diff'
import { snippetSchema } from '../../src/schemas'

const review = {
  state: 'draft' as const,
  provenance: { origin: 'manual' as const, license: 'CC-BY-4.0' as const },
}

describe('R16 —— code 与 blocks 二选一', () => {
  it('单段内容写 code，照常通过', () => {
    const r = snippetSchema.safeParse({
      featureId: 'a/b',
      equivalence: 'identical',
      code: 'x',
      review,
    })
    expect(r.success).toBe(true)
  })

  it('多段内容写 blocks，通过', () => {
    const r = snippetSchema.safeParse({
      featureId: 'a/b',
      equivalence: 'analogous',
      review,
      blocks: [
        { label: '错误写法', code: 'bad' },
        { label: '正确写法', code: 'good' },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('两者并存 → 拒绝（渲染路径无从选择）', () => {
    const r = snippetSchema.safeParse({
      featureId: 'a/b',
      equivalence: 'identical',
      review,
      code: 'x',
      blocks: [{ label: 'L', code: 'y' }],
    })
    expect(r.success).toBe(false)
  })

  it('两者都没有 → 拒绝（空实现应当显式写 equivalence: absent）', () => {
    const r = snippetSchema.safeParse({
      featureId: 'a/b',
      equivalence: 'identical',
      review,
    })
    expect(r.success).toBe(false)
  })

  it('多段里有空 label → 拒绝（并排视图无法说明第 2 段在跟哪一段比）', () => {
    const r = snippetSchema.safeParse({
      featureId: 'a/b',
      equivalence: 'identical',
      review,
      blocks: [{ label: '   ', code: 'x' }],
    })
    expect(r.success).toBe(false)
  })
})

describe('逐段 diff', () => {
  it('段数一致时逐段算，各段行号从 1 各自起算', () => {
    const d = compareBlockArrays(['a\nb', 'c\nd\ne'], ['a\nB', 'c\nd\ne'])
    expect(d).not.toBeNull()
    expect(d!).toHaveLength(2)
    // 第一段第 2 行被替换；第三行（若按整体算会是第 4 行）在段内是第 2 行
    expect(d![0]!.changed.has(2)).toBe(true)
    expect(d![0]!.total).toBe(2)
    // 第二段完全相同
    expect(d![1]!.changed.size).toBe(0)
    expect(d![1]!.total).toBe(3)
  })

  it('段数不一致返回 null —— 调用方据此显示「未做逐行对照」', () => {
    expect(compareBlockArrays(['a'], ['a', 'b'])).toBeNull()
    expect(compareBlockArrays(['a', 'b'], ['a'])).toBeNull()
  })

  it('空输入返回 null，不抛错', () => {
    expect(compareBlockArrays([], [])).toBeNull()
  })
})
