/**
 * 三轴内容模型（ADR-24 / ADR-25）的可执行断言。
 *
 * 这一层要守的是**边建模**这个决定本身：内容按 (基准, 目标) 对撰写，
 * 徽章相对该对所属的基准，因此
 *   · registry 里不该再有全局参照系常量（`equivalenceReference`）
 *   · 每个 topic 必须明确回答「哪个板块、以谁为基准、对照谁」
 *   · 基准列自己的徽章必须是 identical（它就是参照系）
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeContent } from '../../scripts/lib/analyze'
import { ROOT } from '../../scripts/lib/core'
import { SECTION_IDS } from '../../src/generated/sections.gen'

const a = analyzeContent()

describe('三轴内容模型', () => {
  it('registry 里不再有全局参照系常量，取而代之的是默认对比语言', () => {
    expect(a.registry).not.toHaveProperty('equivalenceReference')
    expect(a.registry.defaultCompareLanguage).toBeTruthy()
  })

  it('registry.gen.ts 也不再导出参照系常量', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/generated/registry.gen.ts'), 'utf8')
    expect(src).not.toContain('equivalenceReference')
    expect(src).toContain('defaultCompareLanguageId')
  })

  it('章节分片带着它的三轴归属 —— 视图与 SEO 不必回查 registry', () => {
    const dir = path.join(ROOT, 'src/generated/content')
    const shards = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        fs
          .readdirSync(path.join(dir, d.name))
          .filter((f) => f.endsWith('.json'))
          .map((f) => JSON.parse(fs.readFileSync(path.join(dir, d.name, f), 'utf8')) as Record<string, unknown>),
      )
    expect(shards.length).toBeGreaterThan(0)
    for (const s of shards) {
      /*
       * 判据取自**生成的板块清单**，不是写死的数组。
       * 写死的那版在 ADR-28 把板块变成可注册数据之后就已经过时了 ——
       * 加一个章节型板块就会让这条红，而它本来想说的是
       * 「每个分片的 section 都是已注册的板块」，与具体有几个板块无关。
       */
      expect(SECTION_IDS as readonly string[]).toContain(s.section)
      expect(typeof s.baseline).toBe('string')
      expect(String(s.baseline).length).toBeGreaterThan(0)
    }
  })

  it('基准列自己的徽章恒为 identical —— 它就是参照系', () => {
    for (const { feature, chapter } of a.features) {
      const cfg = a.registry.topics[chapter.topicId]
      if (!cfg?.enabled) continue
      const own = a.snippets.get(feature.id)?.get(cfg.baseline)
      // 基准语言在该 feature 下可以没有实现（例如它根本没有这个概念），
      // 但只要写了，就必须标 identical
      if (own) {
        expect(
          own.equivalence,
          `${feature.id} · ${cfg.baseline} 是基准列，不应标 ${own.equivalence}`,
        ).toBe('identical')
      }
    }
  })

  it('每个已启用的对至少有一类内容，且都被 loader 读到了', () => {
    for (const pair of a.pairs) {
      if (!a.registry.topics[pair.topicId]?.enabled) continue
      const hasChapter = a.chapters.some((c) => c.topicId === pair.topicId)
      const kinds = [
        hasChapter,
        pair.pitfalls.length > 0,
        pair.glossary.length > 0,
        pair.roadmaps.length > 0,
      ].filter(Boolean).length
      expect(kinds, `${pair.topicId} 一个板块的内容都没有`).toBeGreaterThan(0)
    }
  })

  it('每个已启用的对，其 target 都是已启用语言', () => {
    for (const pair of a.pairs) {
      expect(a.enabledLanguageIds).toContain(pair.target)
      expect(a.enabledLanguageIds).toContain(pair.baseline)
    }
  })

  it('路线图不再带 lang 字段 —— 归属由所属目录的 (基准, 目标) 决定', () => {
    for (const pair of a.pairs) {
      for (const stage of pair.roadmaps) {
        expect(stage).not.toHaveProperty('lang')
        expect(stage.baseline).toBe(pair.baseline)
        expect(stage.target).toBe(pair.target)
      }
    }
  })
})
