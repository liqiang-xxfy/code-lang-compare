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

describe('内容分片：一门语言 × 一个存放组', () => {
  const shards = walkJson(path.join(GENERATED, 'content')).map((f) =>
    readJson<{ lang: string; section: string; group: string; boxes: Record<string, RenderedBox> }>(f),
  )

  it('分片带着自己的归属（语言 / 板块 / 存放组），且 section 是已注册板块', () => {
    expect(shards.length).toBeGreaterThan(0)
    for (const s of shards) {
      expect(SECTION_IDS).toContain(s.section)
      expect(s.lang).toBeTruthy()
      expect(s.group).toBeTruthy()
    }
  })

  it('分片路径与它声明的 (语言, 板块, 存放组) 一致 —— 错位会整页空白且不报错', () => {
    const files = walkJson(path.join(GENERATED, 'content'))
    for (const f of files) {
      const s = readJson<{ lang: string; section: string; group: string }>(f)
      const rel = path.relative(GENERATED, f).replace(/\\/g, '/')
      expect(rel).toBe(`content/${s.lang}/${s.section}/${s.group}.json`)
    }
  })

  it('产出的分片与装载结果一一对应（不多不少）', () => {
    const files = walkJson(path.join(GENERATED, 'content'))
    const onDisk = new Set(
      files.map((f) => {
        const s = readJson<{ lang: string; section: string; group: string }>(f)
        return `${s.lang}/${s.section}/${s.group}`
      }),
    )
    expect(onDisk).toEqual(new Set(a.content.keys()))
    for (const key of a.content.keys()) {
      const [lang, section, group] = key.split('/')
      const expected = path.join(GENERATED, 'content', lang!, section!, `${group!}.json`)
      expect(fs.existsSync(expected), key).toBe(true)
    }
  })
})

describe('清单产物 catalog.json', () => {
  const catalog = readJson<RenderedCatalog>(path.join(GENERATED, 'catalog.json'))

  it('featureIndex 的 key 是全局两段 id（没有章节段 —— 章节随基准变）', () => {
    const keys = Object.keys(catalog.featureIndex)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k.split('/')).toHaveLength(2)
  })

  it('每份 catalogs 都带 baseline，且与 registry 的 section 对得上', () => {
    expect(catalog.catalogs.length).toBeGreaterThan(0)
    for (const c of catalog.catalogs) {
      expect(SECTION_IDS).toContain(c.section)
      expect(c.baseline).toBeTruthy()
    }
  })

  it('章节里的 features 已 join 池字段 —— 视图读 feature.title 不需要再查池', () => {
    for (const c of catalog.catalogs) {
      for (const ch of c.chapters) {
        expect(ch.features.length).toBeGreaterThan(0)
        for (const f of ch.features) {
          expect(f.title).toBeTruthy()
          expect(f.kind).toBeTruthy()
          // group 是运行时把「这一行」映射到「哪份分片」的唯一依据，缺了就是整页空白
          expect(f.group).toBeTruthy()
          expect(catalog.featureIndex[`${c.section}/${f.id}`]).toBeDefined()
        }
      }
    }
  })

  it('章节分类确实随基准变 —— 同一板块下两个基准的分组不同', () => {
    const bySection = new Map<string, string[][]>()
    for (const c of catalog.catalogs) {
      const list = bySection.get(c.section) ?? []
      list.push(c.chapters.map((ch) => ch.title))
      bySection.set(c.section, list)
    }
    const differing = [...bySection.values()].some((lists) => lists.length > 1 && new Set(lists.map((l) => l.join('|'))).size > 1)
    expect(differing, '没有任何板块的两个基准给出不同的章节分组 —— 那说明每基准一份分类没生效').toBe(true)
  })
})

/*
 * 骨架期最容易被忽略的一条：**章节分类先于内容落库**（清单一次列全、正文按批填），
 * 所以「章节列表」与「能打开的章节」是两件事。左栏二级、首页计数、上一章/下一章、
 * 板块入口全都必须按后者过滤 —— 漏一处就是一条点进去 404 的死链，而且不报错。
 *
 * 这里钉住的是**判据本身**（运行时 `visibleChaptersOf` / `hasChapterContent`），
 * 以及它与构建期路由判据的同源关系。
 */
describe('章节可见性：骨架先于内容，判据只有一个', () => {
  const catalog = readJson<RenderedCatalog>(path.join(GENERATED, 'catalog.json'))
  const manifest = readJson<{ routes: string[] }>(path.join(GENERATED, 'manifest.json'))

  /** 该语言在该存放组有没有分片 —— 与运行时 `hasBoxGroup` 同判据（都查 glob 键） */
  const hasShard = (lang: string, section: string, group: string) =>
    fs.existsSync(path.join(GENERATED, 'content', lang, section, `${group}.json`))

  const groupsOf = (ch: { features: Array<{ group: string }> }) => [
    ...new Set(ch.features.map((f) => f.group)),
  ]

  it('可见的章是全部章的**保序子序列** —— 过滤不该打乱章节顺序', () => {
    for (const c of catalog.catalogs) {
      const all = c.chapters.map((ch) => ch.id)
      const visible = c.chapters
        .filter((ch) => groupsOf(ch).some((g) => hasShard(c.baseline, c.section, g)))
        .map((ch) => ch.id)
      expect(visible.filter((id) => all.includes(id))).toEqual(visible)
    }
  })

  it('章节路由只在基准自己写了内容时产出 —— 与 04-build 的判据同源', () => {
    const chapterRoutes = manifest.routes.filter(
      (r) => r.startsWith('/compare/') && r.split('/').length === 5,
    )
    expect(chapterRoutes.length).toBeGreaterThan(0)
    for (const route of chapterRoutes) {
      const [, , baseline, section, chapter] = route.split('/')
      const c = catalog.catalogs.find((x) => x.section === section && x.baseline === baseline)
      expect(c, `${route} 对应的章节分组不存在`).toBeTruthy()
      const ch = c!.chapters.find((x) => x.id === chapter)
      expect(ch, `${route} 对应的章节不存在`).toBeTruthy()
      expect(
        groupsOf(ch!).some((g) => hasShard(baseline, section, g)),
        `${route} 进了路由，但基准自己没写这一章的任何一个存放组 —— 会是一页没有参照系的空白`,
      ).toBe(true)
    }
  })

  it('没内容的章不产出路由（骨架期大量如此）—— 反向也要成立', () => {
    for (const c of catalog.catalogs) {
      for (const ch of c.chapters) {
        const openable = groupsOf(ch).some((g) => hasShard(c.baseline, c.section, g))
        const inRoutes = manifest.routes.includes(`/compare/${c.baseline}/${c.section}/${ch.id}`)
        expect(inRoutes, `${c.section}/${c.baseline} 的 '${ch.id}'`).toBe(openable)
      }
    }
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
