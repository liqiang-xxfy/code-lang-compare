/**
 * CI：验证「新增一个板块 = 只加数据」这句承诺。
 *
 * 与 verify-extensibility.ts（加语言）同一手法、同一哲学：**扫描字面量**，
 * 而不是分析行为 —— 任何一处写死的板块 id 都意味着「加板块」时要有人记得去改它，
 * 而漏改往往不报错（`section === 'basics'` 曾被当作「是否基准级」的判据，
 * 在四处使用，漏改的后果是页面静默按迁移教程渲染）。
 *
 * 三个断言：
 *   1. `sections.gen.ts` 与 registry.yaml 同步（防止生成物过期）
 *   2. src/（不含 generated）里没有硬编码的板块 id 字面量
 *   3. 每个 topic 的 section 都是已注册的板块（schema 之外的第二道闸门）
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, loadRegistry } from './lib/core'
import { SECTION_IDS } from '../src/generated/sections.gen'
import { readSectionIds } from './build/generate-sections'

/**
 * 白名单 —— 只放两类，且每条都要写清为什么。
 *
 * 加白名单的意思是「这个字面量不是在对板块做分支判断」，不是「懒得改」。
 * 若某条白名单的理由读完觉得牵强，那多半说明那里真的该改。
 */
const ALLOWLIST: Array<{ file: string; ids: string[]; why: string }> = [
  {
    file: ['src', 'router', 'index.ts'].join(path.sep),
    ids: ['basics', 'roadmap'],
    why:
      '旧地址 shim：P7 之前的 `/compare/<topicId>/<slug>` 与 `/roadmap/<lang>` ' +
      '必须点名历史 topic id 才能把它们重定向到新地址',
  },
  {
    file: ['src', 'content', 'search.ts'].join(path.sep),
    ids: ['glossary', 'roadmap'],
    why: '搜索文档类型与板块名恰好同形，但它是独立的一维（还有 pitfall 单数、concept，本就不是板块）',
  },
  {
    file: ['src', 'views', 'SearchView.vue'].join(path.sep),
    ids: ['glossary', 'roadmap'],
    why: '同上：搜索结果按类型分组与排序',
  },
  {
    file: ['src', 'schemas', 'index.ts'].join(path.sep),
    ids: ['migration'],
    why: 'topic 的 kind（concept|migration）与板块 id 恰好同名，但它是另一根轴：kind 描述内容性质，section 描述归属',
  },
  {
    file: ['src', 'views', 'HomeView.vue'].join(path.sep),
    ids: ['pitfalls'],
    why: '首页的「最该先知道的坑」区块按 dataKey 定位陷阱板块（不是按板块 id 分支），语义上就必须耦合这个概念',
  },
]

let exitCode = 0

/** 去掉注释 —— 注释里写 `section === 'basics'` 是在解释历史，不是硬编码 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|vue|mts|js|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/* ── 断言 1：生成物与 registry.yaml 同步 ──────────────────────────────
 *
 * 为什么单独断言：`sectionSchema` 刻意不用 z.enum(SECTION_IDS)（那会让
 * content:validate 拿上一版清单校验新内容，新增板块报「invalid enum value」）。
 * 代价是生成物可能过期 —— 这条断言把它变成一句清楚的失败信息。
 */
const fromYaml = readSectionIds()
const fromGen = [...SECTION_IDS]
if (fromYaml.join(',') !== fromGen.join(',')) {
  console.error('[verify:sections] ✗ src/generated/sections.gen.ts 与 registry.yaml 不同步')
  console.error(`           registry.yaml: ${fromYaml.join(', ')}`)
  console.error(`           sections.gen : ${fromGen.join(', ')}`)
  console.error('           请运行 npm run registry')
  exitCode = 1
} else {
  console.log(`[verify:sections] ✓ 板块清单已同步（${fromGen.length} 个：${fromGen.join(' → ')}）`)
}

/* ── 断言 2：src/ 里没有硬编码的板块 id ────────────────────────────── */
const offenders: Array<{ file: string; hits: string[] }> = []
for (const file of walk(path.join(ROOT, 'src'))) {
  if (file.includes(`${path.sep}generated${path.sep}`)) continue
  const rel = path.relative(ROOT, file)
  const allow = ALLOWLIST.find((a) => a.file === rel)
  const text = stripComments(fs.readFileSync(file, 'utf8'))
  const hits = fromGen.filter(
    (id) =>
      !allow?.ids.includes(id) &&
      [`'${id}'`, `"${id}"`, `\`${id}\``].some((quoted) => text.includes(quoted)),
  )
  if (hits.length) offenders.push({ file: rel, hits })
}

if (offenders.length) {
  console.error(
    '[verify:sections] ✗ 以下源码硬编码了板块 id —— 加板块时需要有人记得改它们，' +
      '承诺「加板块只加数据」因此不成立：',
  )
  for (const { file, hits } of offenders) {
    console.error(`           - ${file}  →  ${hits.join(', ')}`)
  }
  console.error(
    '           （板块属性请从 repository 的 sectionDefOf / sectionIsChapter / ' +
      'sectionIsMulti / sectionUsesTarget 读，或遍历 orderedSections()）',
  )
  exitCode = 1
} else {
  const allowed = ALLOWLIST.map((a) => a.file).join('、')
  console.log(
    `[verify:sections] ✓ src/ 下（不含 generated）没有硬编码板块 id` +
      `（白名单：${allowed}）`,
  )
}

/* ── 断言 3：每个 topic 的 section 都是已注册的板块 ────────────────
 *
 * schema 的 superRefine 已经在解析时拦了，这里再断言一次是因为
 * `03-validate` 与 `04-build` 共用同一份解析 —— 若有人绕开 registrySchema
 * 直接读 YAML，这条是最后一道。
 */
try {
  const registry = loadRegistry()
  const bad = Object.entries(registry.topics)
    .filter(([, cfg]) => !fromGen.includes(cfg.section as (typeof fromGen)[number]))
    .map(([id, cfg]) => `${id} → ${cfg.section}`)
  if (bad.length) {
    console.error(`[verify:sections] ✗ 以下 topic 引用了未注册的板块：${bad.join(', ')}`)
    exitCode = 1
  } else {
    console.log('[verify:sections] ✓ 全部 topic 的 section 都在注册表里')
  }
} catch (e) {
  console.error(`[verify:sections] ✗ registry.yaml 解析失败：${(e as Error).message}`)
  exitCode = 1
}

if (exitCode === 0) {
  console.log('[verify:sections] 通过：新增板块只需 registry.yaml 的 sections 段 + 内容目录。')
}
process.exit(exitCode)
