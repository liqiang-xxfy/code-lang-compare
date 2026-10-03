/**
 * 池 + 每基准章节分组的装载器（S6.5a）—— 对**真实** content/ 断言。
 *
 * 钉住的是本次改动最核心的那条性质：**章节分组随基准变，而内容不随**。
 * 这里的断言同时是「两步并存」的回归闸门 —— 新装载器读 `catalog/<板块>/`，
 * 旧装载器读 `catalog/*.yaml`，两边都不能越界。
 */
import { describe, expect, it } from 'vitest'
import {
  groupsOfPool,
  loadAllLanguageMeta,
  loadBaselineCatalogs,
  loadFeaturePools,
  loadPoolLanguageContent,
} from '../../scripts/lib/core'
import { baselineCatalogSchema, featurePoolSchema } from '../../src/schemas'

const baselineIds = loadAllLanguageMeta()
  .filter((m) => m.baseline)
  .map((m) => m.id)

const { pools, issues: poolIssues } = loadFeaturePools()
const { catalogs, issues: catalogIssues } = loadBaselineCatalogs(baselineIds)

const express = pools.find((p) => p.section === 'express')
if (!express) throw new Error('没有读到 express 的 feature 池')
const expressPool = express

/** 该基准在 express 板块下，每个 feature id 落在哪一章 */
function chapterOfFeature(baseline: string, featureId: string): string | null {
  const catalog = catalogs.find((c) => c.section === 'express' && c.baseline === baseline)
  if (!catalog) return null
  for (const ch of catalog.chapters) {
    if (ch.features.includes(featureId)) return ch.id
  }
  return null
}

describe('feature 池装载（loadFeaturePools）', () => {
  it('读到 express 的池，文件名与 section 字段一致', () => {
    expect(poolIssues).toEqual([])
    expect(expressPool.title).toBe('基础表达')
  })

  it('池内 feature id 唯一 —— 它是全局 feature id 的第二段', () => {
    const ids = expressPool.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个 feature 都声明了 group（存放组）', () => {
    for (const f of expressPool.features) {
      expect(f.group, f.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('存放组去重后保持首次出现的顺序', () => {
    expect(groupsOfPool(expressPool)).toEqual([
      'bindings',
      'values',
      'operators',
      'control-flow',
      'functions',
      'strings',
    ])
  })

  it('池里没有 order 字段 —— 池的顺序不表达任何东西', () => {
    for (const f of expressPool.features) expect(f).not.toHaveProperty('order')
  })
})

describe('章节分组装载（loadBaselineCatalogs）', () => {
  it('文件名与 baseline 字段一致，且都是基准候选', () => {
    expect(catalogIssues).toEqual([])
    for (const c of catalogs) expect(baselineIds).toContain(c.baseline)
  })

  it('只装了真正写了分组的基准 —— 没写的视为未开工，不是错误', () => {
    const written = catalogs.filter((c) => c.section === 'express').map((c) => c.baseline).sort()
    expect(written).toEqual(['javascript', 'python'])
  })

  it('引用的 feature id 全部能在池里解析 —— 拼错会静默丢行', () => {
    const known = new Set(expressPool.features.map((f) => f.id))
    for (const c of catalogs) {
      for (const ch of c.chapters) {
        for (const id of ch.features) {
          expect(known.has(id), `${c.baseline}/${ch.id} 引用了不存在的 ${id}`).toBe(true)
        }
      }
    }
  })

  it('同一基准下，一个 feature 不会出现在两个章里', () => {
    for (const c of catalogs) {
      const seen = new Set<string>()
      for (const ch of c.chapters) {
        for (const id of ch.features) {
          expect(seen.has(id), `${c.baseline} 的 ${id} 重复出现`).toBe(false)
          seen.add(id)
        }
      }
    }
  })
})

describe('章节分组随基准变，内容不随', () => {
  it('hoisting 只在 JavaScript 的分组里 —— Python 视角下取舍掉了', () => {
    expect(chapterOfFeature('javascript', 'hoisting')).toBe('bindings')
    expect(chapterOfFeature('python', 'hoisting')).toBeNull()
  })

  it('equality 在 JS 落在运算符章、在 Python 落在值与类型章', () => {
    expect(chapterOfFeature('javascript', 'equality')).toBe('operators')
    expect(chapterOfFeature('python', 'equality')).toBe('values')
  })

  it('两个基准对同一批 feature 给出不同的章节名', () => {
    const js = catalogs.find((c) => c.section === 'express' && c.baseline === 'javascript')
    const py = catalogs.find((c) => c.section === 'express' && c.baseline === 'python')
    const titles = (c: typeof js) => c!.chapters.map((ch) => ch.title)
    expect(titles(js)).not.toEqual(titles(py))
  })

  it('而内容文件与基准无关 —— 仍然只有一份，路径第三段是存放组', () => {
    const js = loadPoolLanguageContent('javascript', pools)
    expect(js).toHaveLength(1)
    expect(js[0].section).toBe('express')
    expect(js[0].group).toBe('bindings')
    expect(js[0].file).toMatch(/languages[\\/]javascript[\\/]express[\\/]bindings\.yaml$/)
    expect(Object.keys(js[0].boxes).sort()).toEqual([
      'declaration',
      'hoisting',
      'mutability',
      'scope',
      'shadowing',
    ])
  })

  it('box 的 key 必须是池里该存放组的 feature —— 别的组的 key 会被 R21 拦住', () => {
    const groupMembers = new Set(
      expressPool.features.filter((f) => f.group === 'bindings').map((f) => f.id),
    )
    for (const lang of ['javascript', 'python']) {
      for (const g of loadPoolLanguageContent(lang, pools)) {
        const members = new Set(
          expressPool.features.filter((f) => f.group === g.group).map((f) => f.id),
        )
        for (const key of Object.keys(g.boxes)) expect(members.has(key), `${lang}/${key}`).toBe(true)
      }
      expect(groupMembers.size).toBeGreaterThan(0)
    }
  })
})

describe('私有目录约定', () => {
  it('_template 默认不参与装载', () => {
    expect(loadPoolLanguageContent('_template', pools)).toEqual([])
  })

  it('显式要求时能读到（作者靠它当脚手架）', () => {
    const tpl = loadPoolLanguageContent('_template', pools, { includePrivate: true })
    expect(tpl).toHaveLength(1)
    expect(tpl[0].group).toBe('bindings')
  })
})

describe('新 schema 的自洽约束', () => {
  it('池的 feature 必须给 group', () => {
    const pool = { section: 'express', title: 'x', features: [{ id: 'a', title: 'A', kind: 'syntax' }] }
    expect(featurePoolSchema.safeParse(pool).success).toBe(false)
  })

  it('章节分组必须声明 section 与 baseline，且拒绝未知字段', () => {
    const ok = {
      section: 'express',
      baseline: 'javascript',
      chapters: [{ id: 'a', title: 'A', features: ['x'] }],
    }
    expect(baselineCatalogSchema.safeParse(ok).success).toBe(true)
    expect(baselineCatalogSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    expect(baselineCatalogSchema.safeParse({ section: 'express', chapters: ok.chapters }).success).toBe(
      false,
    )
  })

  it('章节分组的 features 是 id 引用，不内联 feature 对象', () => {
    const bad = {
      section: 'express',
      baseline: 'javascript',
      chapters: [{ id: 'a', title: 'A', features: [{ id: 'x', title: 'X', kind: 'syntax' }] }],
    }
    expect(baselineCatalogSchema.safeParse(bad).success).toBe(false)
  })
})
