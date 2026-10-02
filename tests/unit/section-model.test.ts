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

  /**
   * 说明的落点，在**构建产物**上再钉一次。
   *
   * 内容侧的归属由 content-contract 断言，这里管的是另一半：分片里到底有没有
   * 把说明渲染出来。多列板块的 feature 一旦带上 `bodyHtml`，视图就会在整块
   * 上方渲染一份横跨所有列的共享说明（矩阵模式下更是完全看不到它）。
   */
  it('说明的落点：多列板块在每列 snippet 上，feature 上没有', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src/generated/manifest.json'), 'utf8'),
    ) as { sections: Array<{ id: string; columns: string }> }
    const multi = new Set(
      manifest.sections.filter((s) => s.columns === 'multi').map((s) => s.id),
    )
    expect(multi.size).toBeGreaterThan(0)

    interface Shard {
      section: string
      baseline: string
      features: Array<{
        id: string
        bodyHtml?: string
        snippets: Record<string, { bodyHtml?: string }>
      }>
    }
    const dir = path.join(ROOT, 'src/generated/content')
    let checked = 0
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      for (const f of fs.readdirSync(path.join(dir, d.name))) {
        if (!f.endsWith('.json')) continue
        const shard = JSON.parse(
          fs.readFileSync(path.join(dir, d.name, f), 'utf8'),
        ) as Shard
        if (!multi.has(shard.section)) continue
        for (const feature of shard.features) {
          checked += 1
          expect(feature.bodyHtml, `${feature.id} 不该有共享说明`).toBeUndefined()
          /*
           * 只断言**基准列**有说明。对比列的 543 格仍在分批补（R18 是过渡期
           * warn），把「每列都有」写进测试会让内容补齐之前测试一直红。
           */
          expect(
            feature.snippets[shard.baseline]?.bodyHtml,
            `${feature.id} · ${shard.baseline}（基准列）缺少列内说明`,
          ).toBeTruthy()
        }
      }
    }
    expect(checked, '没有扫到任何多列板块的 feature').toBeGreaterThan(0)
  })
})
