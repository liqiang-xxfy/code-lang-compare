import { describe, expect, it } from 'vitest'
import { compareToBaseline, getCachedDiff } from '../../src/content/diff'

describe('compareToBaseline —— 行级差异（运行时，ADR-05）', () => {
  it('完全相同的代码：无差异', () => {
    const d = compareToBaseline('a = 1\nb = 2', 'a = 1\nb = 2')
    expect(d.added.size).toBe(0)
    expect(d.changed.size).toBe(0)
    expect(d.total).toBe(2)
  })

  it('把「替换」与「纯新增」区分开', () => {
    const base = 'line1\nline2\nline3'
    const target = 'line1\nLINE2\nline3\nline4'
    const d = compareToBaseline(base, target)
    expect(d.changed.has(2)).toBe(true) // 第 2 行被替换
    expect(d.added.has(4)).toBe(true) // 第 4 行是纯新增
    expect(d.added.has(2)).toBe(false)
    expect(d.total).toBe(4)
  })

  it('空输入直接返回空结果，不抛错', () => {
    expect(compareToBaseline('', 'x').total).toBe(0)
    expect(compareToBaseline('x', '').added.size).toBe(0)
  })

  it('缓存命中返回同一对象（同一 feature×基准×目标只算一次）', () => {
    const key = 'k-unique-test'
    const first = getCachedDiff(key, 'a\nb', 'a\nc')
    const second = getCachedDiff(key, 'a\nb', 'a\nc')
    expect(second).toBe(first)
  })

  it('不产出任何「相似度百分比」—— 那是被刻意删掉的伪精度指标', () => {
    const d = compareToBaseline('a\nb\nc', 'x\ny\nz') as unknown as Record<string, unknown>
    expect(d.similarity).toBeUndefined()
    expect(d.score).toBeUndefined()
    expect(d.diffRatio).toBeUndefined()
  })
})
