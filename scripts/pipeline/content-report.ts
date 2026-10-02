/**
 * 内容覆盖率报告（本地用，不阻断）
 *
 *   npm run content:report
 */
import { analyzeContent, baselineBodyMentions } from '../lib/analyze'

const a = analyzeContent()

/** 多列并排的板块（基础语法 / 心智模型）—— 说明在每列代码下方 */
const multiTopics = Object.entries(a.registry.topics)
  .filter(([, cfg]) => cfg.enabled && a.registry.sections[cfg.section]?.columns === 'multi')
  .map(([id, cfg]) => ({ id, baseline: cfg.baseline }))

const lines: string[] = []
lines.push('')
lines.push('内容覆盖率报告')
lines.push('='.repeat(56))
lines.push(`发布策略        ${a.registry.publishPolicy}`)
lines.push(`语言（全集）    ${a.allLanguageIds.join(', ')}`)
lines.push(`语言（启用）    ${a.enabledLanguageIds.join(', ')}`)
lines.push(`Feature 总数    ${a.stats.featureCount}`)
lines.push(`实现总数        ${a.stats.snippetCount}`)
lines.push('')

lines.push('审阅状态分布')
for (const [state, count] of Object.entries(a.stats.byState).sort()) {
  lines.push(`  ${state.padEnd(10)} ${String(count).padStart(4)}`)
}
lines.push('')

lines.push('内容来源分布')
for (const [origin, count] of Object.entries(a.stats.byOrigin).sort()) {
  lines.push(`  ${origin.padEnd(14)} ${String(count).padStart(4)}`)
}
lines.push('')

lines.push('各语言覆盖率')
for (const [lang, c] of Object.entries(a.stats.coverage)) {
  const pct = c.total ? Math.round((c.have / c.total) * 100) : 0
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·')
  lines.push(`  ${lang.padEnd(12)} ${bar} ${c.have}/${c.total} (${pct}%)`)
}
lines.push('')

/*
 * 多列板块的说明覆盖率。
 *
 * 这两块是**分批补内容时的账本**：校验里 R18 / R12 是按 topic 汇总的
 * （缺口以百计，逐条会把 error 埋掉），明细在这里给。
 */
lines.push('多列板块：每列代码下方的说明（基准列=本语言客观事实，对比列=与基准的差别）')
let bHave = 0
let bTotal = 0
let cHave = 0
let cTotal = 0
for (const { id, baseline } of multiTopics) {
  let bh = 0
  let bt = 0
  let ch = 0
  let ct = 0
  for (const { feature, chapter } of a.features) {
    if (chapter.topicId !== id) continue
    for (const [lang, s] of a.snippets.get(feature.id) ?? []) {
      if (!a.enabledLanguageIds.includes(lang)) continue
      if (lang === baseline) {
        bt += 1
        if (s.body?.trim()) bh += 1
      } else {
        ct += 1
        if (s.body?.trim()) ch += 1
      }
    }
  }
  bHave += bh
  bTotal += bt
  cHave += ch
  cTotal += ct
  lines.push(
    `  ${id.padEnd(22)}基准 ${String(bh).padStart(3)}/${String(bt).padEnd(4)}对比 ${String(ch).padStart(3)}/${ct}`,
  )
}
lines.push(
  `  ${'合计'.padEnd(20)}基准 ${String(bHave).padStart(3)}/${String(bTotal).padEnd(4)}对比 ${String(cHave).padStart(3)}/${cTotal}`,
)
lines.push('')

const mentions = baselineBodyMentions(a)
lines.push(`待清理：基准列 body 点名了屏幕外的语言（${mentions.length} 条，对照说明应写进对应语言的对比列）`)
lines.push(
  mentions.length
    ? mentions.map((m) => `  · ${m.featureId} · 点名 ${m.name}（命中「${m.word}」）`).join('\n')
    : '  （无）',
)
lines.push('')

lines.push('待办：尚未达到 reviewed 的条目')
const pending = a.features.flatMap(({ feature }) => {
  const bucket = a.snippets.get(feature.id) ?? new Map()
  return [...bucket.entries()]
    .filter(([lang, s]) => a.enabledLanguageIds.includes(lang) && s.review.state === 'draft')
    .map(([lang]) => `  · ${feature.id} · ${lang}`)
})
lines.push(pending.length ? pending.join('\n') : '  （无，全部已校对）')

const errors = a.issues.filter((i) => i.level === 'error')
const warns = a.issues.filter((i) => i.level === 'warn')
lines.push('')
lines.push(`校验：error ${errors.length} / warn ${warns.length}`)
lines.push('='.repeat(56))
lines.push('')

console.log(lines.join('\n'))

if (errors.length) {
  console.error(`有 ${errors.length} 条 error 级问题，构建会被阻断。请运行 npm run content:validate 查看详情。`)
  process.exit(1)
}
