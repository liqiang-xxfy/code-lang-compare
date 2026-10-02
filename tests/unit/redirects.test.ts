/**
 * 旧地址的重定向。
 *
 * 静态托管做不了服务端 301，只能靠路由层的 redirect —— 所以这组断言是
 * 「老链接还能不能用」的唯一保障。另外它顺带守住两条设计约束：
 *  · 重定向只允许依赖构建期常量（读 localStorage 会让 SSG 与客户端两侧不一致）
 *  · **目标语言不进新地址**（P8）：所以旧地址里带的方向信息要靠
 *    `legacyTopicTarget` / `legacyRoadmapTarget` 交给守卫并进全局选择
 */
import { describe, expect, it } from 'vitest'
import { defaultBaselineLanguageId, defaultCompareLanguageId } from '@/generated/registry.gen'
import {
  isEnabledLanguage,
  isSection,
  legacyRoadmapTarget,
  legacyTopicPath,
  legacyTopicTarget,
  sectionEntryPath,
} from '@/router'

describe('旧地址 → 新地址', () => {
  it('旧的两段地址 /compare/<topicId>/<slug> 能还原', () => {
    expect(legacyTopicPath('basics', '01-variables')).toBe(
      '/compare/javascript/basics/01-variables',
    )
    // 新地址里没有目标语言 —— 方向靠 legacyTopicTarget 交给守卫
    expect(legacyTopicPath('js2python', '01-functions')).toBe(
      '/compare/javascript/migration/01-functions',
    )
    expect(legacyTopicTarget('js2python')).toBe('python')
    expect(legacyTopicTarget('basics')).toBeNull()
  })

  it('板块入口 /compare/<基准>/<板块> 落到该板块第一项', () => {
    expect(isSection('basics') && isEnabledLanguage('javascript')).toBe(true)
    expect(sectionEntryPath('javascript', 'basics')).toBe(
      '/compare/javascript/basics/01-variables',
    )
    expect(sectionEntryPath('python', 'basics')).toBe('/compare/python/basics/01-variables')
    expect(sectionEntryPath('javascript', 'pitfalls')).toBe('/compare/javascript/pitfalls')
  })

  it('迁移教程入口的段数与路由形状一致 —— 不带目标语言', () => {
    const path = sectionEntryPath('javascript', 'migration')
    expect(path.startsWith('/compare/javascript/migration/')).toBe(true)
    // 路由是 /compare/:baseline/migration/:chapterSlug，正好 4 段。
    // 曾经多拼一段 target 涨到 5 段，匹配不上任何路由 ——
    // 左栏「迁移教程」入口与切基准时的 migration 回落因此一直是 404。
    expect(path.split('/').filter(Boolean)).toHaveLength(4)
  })

  it('认不出的段一律 404，不猜', () => {
    expect(legacyTopicPath('nonsense', '01-variables')).toBe('/404')
    expect(isSection('nonsense')).toBe(false)
    expect(isEnabledLanguage('nonsense')).toBe(false)
  })

  it('旧路线图地址：出发端补成默认基准，目标交给守卫并进选择', () => {
    expect(legacyRoadmapTarget('python')).toEqual({ baseline: 'javascript', target: 'python' })
  })

  it('旧路线图地址里的默认基准回落到默认对比语言（从自己学自己没有意义）', () => {
    expect(legacyRoadmapTarget('javascript')).toEqual({
      baseline: 'javascript',
      target: defaultCompareLanguageId,
    })
    expect(defaultBaselineLanguageId).toBe('javascript')
  })

  it('没有对应内容的方向回落到 404，而不是空白页', () => {
    // typescript 尚未启用，任何 (基准, 目标) 对里都没有它
    expect(legacyRoadmapTarget('typescript')).toBeNull()
  })

  it('旧的 /compare/basics/<slug> 落到默认基准那一套（basics 是唯一改过名的旧 topic）', () => {
    expect(legacyTopicPath('basics', '06-objects')).toBe(
      '/compare/javascript/basics/06-objects',
    )
    // 该基准下没有这一章就 404，而不是生成一个空白页
    expect(legacyTopicPath('basics', '99-nope')).toBe('/404')
  })
})
