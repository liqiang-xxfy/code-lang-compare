/**
 * 多段对照代码（`blocks`）的逐段 diff。
 *
 * 各段各有自己的行号空间 —— 拼接起来整体算的行号对不上任何一段，着色会整体错位。
 * 所以两侧段数一致时按序号逐段算；段数不一致时**拒绝**（返回 null），
 * 由调用方显示「分段结构不同，未做逐行对照」。宁可不着色，也不给出错误的对位。
 *
 * 契约部分（`code` 与 `blocks` 不能并存、每段必须有非空 label）在
 * `pool-loader.test.ts` 的「对比框契约」里对 `boxSchema` 断言 ——
 * v1 的 `snippetSchema` 已随 S8 清理删除，本文件只留运行时 diff。
 */
import { describe, expect, it } from 'vitest'
import { compareBlockArrays } from '../../src/content/diff'

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
