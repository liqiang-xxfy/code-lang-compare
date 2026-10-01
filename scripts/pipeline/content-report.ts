/**
 * 内容覆盖率报告（本地用，不阻断）
 *
 *   npm run content:report
 */
import { analyzeContent } from '../lib/analyze'

const a = analyzeContent()

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
