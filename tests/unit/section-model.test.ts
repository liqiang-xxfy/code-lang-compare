/**
 * v2 内容模型的可执行断言。
 *
 * 前两组**读真实构建产物**（`src/generated/**`）—— 它们既是回归测试，
 * 也是「构建产物与运行时契约没漂移」的第二道闸门。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeContent } from '../../scripts/lib/analyze'
import { ROOT } from '../../scripts/lib/core'
import { SECTION_IDS } from '../../src/generated/sections.gen'
import { badgeOf, explanationOf } from '../../src/content/boxView'
import type { RenderedBox, RenderedCatalog } from '../../src/schemas'

const a = analyzeContent()

const GENERATED = path.join(ROOT, 'src', 'generated')

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

/** 递归收集某个目录下的全部 .json */
function walkJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJson(full))
    else if (e.name.endsWith('.json')) out.push(full)
  }
  return out
}

describe('运行时常量与注册表', () => {
  it('registry.gen.ts 里没有全局参照系常量，取而代之的是默认对比语言', () => {
    const src = fs.readFileSync(path.join(GENERATED, 'registry.gen.ts'), 'utf8')
    expect(src).not.toContain('equivalenceReference')
    expect(src).toContain('defaultCompareLanguageId')
  })

  it('sections.gen.ts 与 registry.yaml 的 sections 段同源', () => {
    expect([...SECTION_IDS]).toEqual(
      Object.entries(a.registry.sections)
        .sort((x, y) => x[1].order - y[1].order)
        .map(([id]) => id),
    )
  })
})

describe('内容分片：一门语言 × 一个章节', () => {
  const shards = walkJson(path.join(GENERATED, 'content')).map((f) =>
    readJson<{ lang: string; section: string; chapter: string; boxes: Record<string, RenderedBox> }>(f),
  )

  it('分片带着自己的三轴归属，且 section 是已注册板块', () => {
    expect(shards.length).toBeGreaterThan(0)
    for (const s of shards) {
      expect(SECTION_IDS).toContain(s.section)
      expect(s.lang).toBeTruthy()
      expect(s.chapter).toBeTruthy()
    }
  })

  it('分片路径与它声明的 (语言, 板块, 章节) 一致 —— 错位会整页空白且不报错', () => {
    const files = walkJson(path.join(GENERATED, 'content'))
    for (const f of files) {
      const s = readJson<{ lang: string; section: string; chapter: string }>(f)
      const rel = path.relative(GENERATED, f).replace(/\\/g, '/')
      expect(rel).toBe(`content/${s.lang}/${s.section}/${s.chapter}.json`)
    }
  })

  it('每个清单章节都有对应的分片路径可加载（键能拼出来）', () => {
    for (const c of a.catalogs) {
      for (const ch of c.chapters) {
        for (const lang of a.enabledLanguageIds) {
          const expected = path.join(GENERATED, 'content', lang, c.section, `${ch.id}.json`)
          const hasContent = a.content.has(`${lang}/${c.section}/${ch.id}`)
          expect(fs.existsSync(expected), `${lang}/${c.section}/${ch.id}`).toBe(hasContent)
        }
      }
    }
  })
})

describe('清单产物 catalog.json', () => {
  const catalog = readJson<RenderedCatalog>(path.join(GENERATED, 'catalog.json'))

  it('featureIndex 的 key 是全局三段 id', () => {
    const keys = Object.keys(catalog.featureIndex)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k.split('/')).toHaveLength(3)
  })

  it('catalogs 与 registry 的 section 对得上', () => {
    for (const c of catalog.catalogs) expect(SECTION_IDS).toContain(c.section)
  })
})

describe('双角色取值（boxView）', () => {
  const box: RenderedBox = {
    lang: 'python',
    code: 'x = 1',
    html: '<pre/>',
    lineCount: 1,
    notes: [],
    baselineHtml: '<p>基础描述</p>',
    vsHtml: { javascript: '<p>与 JS 的差别</p>' },
    equivalence: { javascript: 'divergent' },
    absent: false,
    reviewState: 'draft',
    provenanceOrigin: 'llm',
  }

  it('基准列取 baselineHtml，对比列取 vsHtml[当前基准]', () => {
    expect(explanationOf(box, 'python', 'python')).toBe(box.baselineHtml)
    expect(explanationOf(box, 'python', 'javascript')).toBe('<p>与 JS 的差别</p>')
    // 没有这一份就是 undefined（视图留白），而不是回落到另一套
    expect(explanationOf(box, 'python', 'java')).toBeUndefined()
  })

  it('基准列不渲染徽章；对比列缺 key 才是 identical', () => {
    expect(badgeOf(box, 'python', 'python')).toBeNull()
    expect(badgeOf(box, 'python', 'javascript')).toBe('divergent')
    expect(badgeOf(box, 'python', 'java')).toBe('identical')
  })

  it('absent 必须短路掉 equivalence 的缺省值 —— 否则灰格会顶一枚 =', () => {
    const absent: RenderedBox = { ...box, absent: true, equivalence: {} }
    expect(badgeOf(absent, 'python', 'javascript')).toBe('absent')
  })

  it('真实内容里，基准语言作基准列时是同样的读法（同一份数据换角色，不重新加载）', () => {
    // 内容分片按语言存，所以「谁当基准」只影响读哪一槽，不影响加载了哪几份
    const shards = walkJson(path.join(GENERATED, 'content')).map((f) =>
      readJson<{ lang: string; boxes: Record<string, RenderedBox> }>(f),
    )
    let checked = 0
    for (const s of shards) {
      for (const box of Object.values(s.boxes)) {
        // 这门语言作基准列时：有 baselineHtml 才有说明，且徽章恒不渲染
        expect(badgeOf(box, s.lang, s.lang)).toBeNull()
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('速查三兄弟（内容在 content/pairs/，契约沿用 v1）', () => {
  it('每个方向至少有一类内容，且归属由目录名反查得到', () => {
    expect(a.pairs.length).toBeGreaterThan(0)
    for (const p of a.pairs) {
      const total = p.pitfalls.length + p.glossary.length + p.roadmaps.length
      expect(total, `${p.dir} 一份内容都没有`).toBeGreaterThan(0)
      expect(p.baseline).not.toBe(p.target)
    }
  })

  it('路线图阶段带的是 pair 归属，不带 lang 字段', () => {
    for (const stages of Object.values(a.roadmaps)) {
      for (const s of stages) {
        expect(s).not.toHaveProperty('lang')
        expect(s.baseline).toBeTruthy()
        expect(s.target).toBeTruthy()
      }
    }
  })
})
