/**
 * 内容覆盖率报告（本地用，不阻断）
 *
 *   npm run content:report
 *
 * v2 的账本是「每门语言 × 每个板块」的对比框覆盖 ——
 * 校验里 R20b / R22 / R24 按 (语言, 板块) 汇总成一条（缺口以百计，逐条会把 error 埋掉），
 * 明细在这里给。
 */
import { analyzeContent } from '../lib/analyze'

const a = analyzeContent()

const lines: string[] = []
const P = (s: string, w: number) => s.padEnd(w)

lines.push('')
lines.push('内容覆盖率报告（v2）')
lines.push('='.repeat(60))
lines.push(`发布策略        ${a.registry.publishPolicy}`)
lines.push(`基准（候选）    ${a.baselineIds.join(', ')}`)
lines.push(`语言（全集）    ${a.allLanguageIds.join(', ')}`)
lines.push(`语言（启用）    ${a.enabledLanguageIds.join(', ')}`)
lines.push(`Feature 总数    ${a.stats.featureCount}（${a.pools.length} 个板块的池）`)
lines.push(`章节分组        ${a.catalogs.length} 份（每基准一份）`)
lines.push(`对比框总数      ${a.stats.boxCount}`)
lines.push('')

lines.push('审阅状态分布')
for (const [state, count] of Object.entries(a.stats.byState).sort()) {
  lines.push(`  ${P(state, 10)} ${String(count).padStart(4)}`)
}
lines.push('')

lines.push('内容来源分布')
for (const [origin, count] of Object.entries(a.stats.byOrigin).sort()) {
  lines.push(`  ${P(origin, 14)} ${String(count).padStart(4)}`)
}
lines.push('')

lines.push('各语言覆盖率（全部板块合计）')
for (const lang of a.enabledLanguageIds) {
  const c = a.stats.coverage[lang]!
  const pct = c.total ? Math.round((c.have / c.total) * 100) : 0
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
  lines.push(`  ${P(lang, 12)} ${bar} ${c.have}/${c.total} (${pct}%)`)
}
lines.push('')

/*
 * 每门语言 × 每个板块：写了多少格、其中多少格把 vs 写全了。
 * 「vs 写全」是基准候选要两份、非基准要三份 —— 视角无法互相推导。
 */
/*
 * 账本按**池**走，不按章节分组 —— 池与基准无关，是内容的真实归属；
 * 章节分组只是同一批知识点在不同基准下的摆法，按它统计会把同一个 feature 数三遍。
 */
lines.push('逐板块账本（格子数 / vs 写全的格子数）')
for (const pool of a.pools) {
  const ids = pool.features.map((f) => `${pool.section}/${f.id}`)
  lines.push(`  ── ${pool.section}（${ids.length} 个 feature）`)
  for (const lang of a.enabledLanguageIds) {
    let have = 0
    let vsFull = 0
    for (const gid of ids) {
      const box = a.boxes.get(gid)?.get(lang)
      if (!box) continue
      have += 1
      const required = a.baselineIds.includes(lang)
        ? a.baselineIds.filter((b) => b !== lang)
        : a.baselineIds
      if (required.every((b) => box.vs[b]?.trim())) vsFull += 1
    }
    lines.push(`     ${P(lang, 12)} ${String(have).padStart(3)}/${String(ids.length).padEnd(4)}  vs 全 ${vsFull}`)
  }

  /*
   * 逐**存放组**的明细 —— 骨架落库后板块级的合计会长期停在「全部欠账」，
   * 真正在动的是这一层：S7 的一批 = 一个存放组 × 三基准。
   * 末尾的「✔」表示三个基准都写全了这一组（这一批可以划掉了）。
   */
  const groups = [...new Set(pool.features.map((f) => f.group))]
  const titleCol = Math.max(...groups.map((g) => g.length), 4) + 2
  lines.push(`     ${P('存放组', titleCol)}${a.enabledLanguageIds.map((l) => P(l, 12)).join('')}`)
  for (const group of groups) {
    const members = pool.features.filter((f) => f.group === group).map((f) => `${pool.section}/${f.id}`)
    const cells: string[] = []
    let baselinesDone = true
    for (const lang of a.enabledLanguageIds) {
      const have = members.filter((gid) => a.boxes.get(gid)?.get(lang)).length
      if (a.baselineIds.includes(lang) && have !== members.length) baselinesDone = false
      cells.push(P(`${have}/${members.length}`, 12))
    }
    lines.push(`     ${P(group, titleCol)}${cells.join('')}${baselinesDone ? ' ✔' : ''}`)
  }
}
lines.push('')

lines.push('待办：尚未达到 reviewed 的对比框')
const pending = [...a.boxes.entries()].flatMap(([gid, bucket]) =>
  [...bucket.entries()]
    .filter(([, box]) => box.review.state === 'draft')
    .map(([lang]) => `  · ${gid} · ${lang}`),
)
lines.push(pending.length ? pending.join('\n') : '  （无，全部已校对）')

const errors = a.issues.filter((i) => i.level === 'error')
const warns = a.issues.filter((i) => i.level === 'warn')
lines.push('')
lines.push(`校验：error ${errors.length} / warn ${warns.length}`)
lines.push('='.repeat(60))
lines.push('')

console.log(lines.join('\n'))

if (errors.length) {
  console.error(`有 ${errors.length} 条 error 级问题，构建会被阻断。请运行 npm run content:validate 查看详情。`)
  process.exit(1)
}
