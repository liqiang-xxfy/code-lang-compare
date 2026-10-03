/**
 * 阶段 [3] validate —— 关键质量闸门
 *
 * 规则集（v2，见 docs/对比内容架构.md §6）：
 *   R1       schema     结构合法性
 *   R3       provenance 出处 / 许可 / 台账命中
 *   R4/R9    @note      标记全部解析，且前缀必须是该语言自己的注释符
 *   R5       refs       引用完整性（refFeatureId / 陷阱 featureId / 词典语言）
 *   R6       status     发布门槛（受 registry.publishPolicy 控制）
 *   R7       links      URL 协议白名单（仅 https）
 *   R8       naming     目录名 === meta.id、基准候选与默认值自洽
 *   R10      台账       每条许可义务都有可核对的履行位置
 *   R17      review     校对状态升级需留记录
 *   R20      清单-文件  孤儿文件 error / 覆盖率缺口 warn / 文件名与 section 一致
 *   R21      key 合法性 语言文件里的 box key 必须在清单的该章里
 *   R22      vs 完整性  基准候选两份、非基准三份（迁移期 warn）
 *   R23      基准列非空 基准候选每个 feature 都要有 baseline（迁移期 warn）
 *   R24      存疑空框   清单有、文件没写（迁移期 warn）
 *   R25      幽灵语言   vs.<基准> / baseline 里点名屏幕外的语言（warn）
 *   R26      absent 说明 absent 且给了代码时必须有说明（warn）
 *
 * 有 error 级问题 → 非零退出，CI 阻断。
 */
import path from 'node:path'
import type { Issue } from '../../src/schemas'
import { GENERATED_DIR, writeJson } from '../lib/core'
import { analyzeContent, formatIssues } from '../lib/analyze'

export interface ValidationReport {
  generatedAt: string
  publishPolicy: string
  enabledLanguages: string[]
  allLanguages: string[]
  stats: ReturnType<typeof analyzeContent>['stats']
  issueCount: { error: number; warn: number }
  issues: Issue[]
}

export function validate(): { report: ValidationReport; ok: boolean } {
  const a = analyzeContent()
  const errors = a.issues.filter((i) => i.level === 'error')
  const warns = a.issues.filter((i) => i.level === 'warn')

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    publishPolicy: a.registry.publishPolicy,
    enabledLanguages: a.enabledLanguageIds,
    allLanguages: a.allLanguageIds,
    stats: a.stats,
    issueCount: { error: errors.length, warn: warns.length },
    issues: a.issues,
  }

  return { report, ok: errors.length === 0 }
}

function printReport(report: ValidationReport): void {
  const s = report.stats
  const lines: string[] = []
  lines.push('[validate] ── 内容校验 ──────────────────────────────')
  lines.push(`  语言：全集 ${report.allLanguages.length} 门（${report.allLanguages.join(', ')}）`)
  lines.push(`        启用 ${report.enabledLanguages.length} 门（${report.enabledLanguages.join(', ')}）`)
  lines.push(`  发布策略：${report.publishPolicy}`)
  lines.push(`  内容规模：${s.featureCount} 个 Feature / ${s.boxCount} 个对比框`)
  lines.push(
    `  审阅状态：${Object.entries(s.byState)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ') || '（无）'}`,
  )
  lines.push(
    `  内容来源：${Object.entries(s.byOrigin)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ') || '（无）'}`,
  )
  lines.push('  覆盖率：')
  for (const [lang, c] of Object.entries(s.coverage)) {
    const pct = c.total ? Math.round((c.have / c.total) * 100) : 0
    lines.push(`    ${lang.padEnd(12)} ${c.have}/${c.total}  (${pct}%)`)
  }

  const errors = report.issues.filter((i) => i.level === 'error')
  const warns = report.issues.filter((i) => i.level === 'warn')
  lines.push(`\n  error ${errors.length} 条：`)
  lines.push(formatIssues(errors))
  lines.push(`\n  warn ${warns.length} 条：`)
  lines.push(formatIssues(warns))
  lines.push('[validate] ─────────────────────────────────────────')
  console.log(lines.join('\n'))
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (isMain) {
  const { report, ok } = validate()
  writeJson(path.join(GENERATED_DIR, 'report.json'), report)
  printReport(report)
  if (!ok) {
    console.error('\n[validate] 校验失败：存在 error 级问题，已阻断构建。')
    process.exit(1)
  }
  console.log('\n[validate] 通过。')
}
