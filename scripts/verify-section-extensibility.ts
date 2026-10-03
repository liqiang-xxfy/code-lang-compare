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
 *   3. `content/catalog/` 下的板块目录与 registry 的 sections 双向一致
 *      （建了内容目录却忘了注册，或注册了却没有目录 —— 两边都会静默半开工）
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
  /*
   * v2 删掉了旧地址 shim（旧 URL 一律 404），`src/router/index.ts` 原本为
   * `basics` / `roadmap` 留的条目随之成为死条目，已收敛掉 —— 字面量消失之后再
   * 留着白名单，就等于给后来的同名写法留了一扇没人记得的后门。
   */
  {
    file: ['src', 'content', 'search.ts'].join(path.sep),
    ids: ['glossary', 'roadmap'],
    why: '搜索文档类型与板块名恰好同形，但它是独立的一维（还有 pitfall 单数、feature，本就不是板块）',
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
  {
    file: ['src', 'views', 'FeatureView.vue'].join(path.sep),
    ids: ['pitfalls'],
    why:
      '特性页的「相关迁移陷阱」同样按 dataKey 定位陷阱板块 —— 「这个知识点在别处踩过什么坑」' +
      '这件事本身就锚在陷阱这个概念上，不是按板块 id 分支',
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

/* ── 断言 3：content/catalog/ 的板块目录 ↔ registry 的 sections 双向一致 ──
 *
 * v1 的这道断言查「每个 topic 的 section 都注册过」，靠的是 registry.topics。
 * v2 取消了 topic 概念，但**同一类错误换了形态仍然存在**：建了
 * `content/catalog/<板块>/` 却忘了在 registry.yaml 里注册（或反之）。
 * 两个方向都不会报错 —— 前者整个目录被静默忽略，后者该板块永远没有内容。
 *
 * 判据只对 `shape: chapter` 的板块成立 —— 速查三兄弟是 `shape: list`，
 * 它们的内容按方向放在 `content/pairs/`，本来就没有池、也不该有 catalog 目录
 * （这一条是写这道断言时被它自己抓出来的：第一版对全部板块求值，
 * 立刻报 pitfalls / glossary / roadmap 三个「缺目录」）。
 *
 * 顺带断言每个章节型板块目录都有池文件：章节分组可以缺（= 该基准还没开工，
 * 左栏隐藏），但**池必须存在** —— 没有池的板块在构建期无内容可查。
 */
const registry = loadRegistry()
const chapterSections = Object.entries(registry.sections)
  .filter(([, def]) => def.shape === 'chapter')
  .map(([id]) => id)
const catalogDir = path.join(ROOT, 'content', 'catalog')
const onDisk = fs.existsSync(catalogDir)
  ? fs
      .readdirSync(catalogDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)
  : []

const unregistered = onDisk.filter((id) => !fromGen.includes(id as (typeof fromGen)[number]))
const missingDir = chapterSections.filter((id) => !onDisk.includes(id))
const noPool = onDisk.filter((id) => !fs.existsSync(path.join(catalogDir, id, 'features.yaml')))

if (unregistered.length) {
  console.error(
    `[verify:sections] ✗ 这些内容目录没有在 registry.yaml 的 sections 段注册：${unregistered.join(', ')}`,
  )
  exitCode = 1
}
if (missingDir.length) {
  console.error(
    `[verify:sections] ✗ 这些 shape: chapter 的板块没有 content/catalog/ 目录：${missingDir.join(', ')}`,
  )
  exitCode = 1
}
if (noPool.length) {
  console.error(`[verify:sections] ✗ 这些板块目录缺少 features.yaml（池）：${noPool.join(', ')}`)
  exitCode = 1
}
if (!unregistered.length && !missingDir.length && !noPool.length) {
  console.log(
    `[verify:sections] ✓ ${chapterSections.length} 个章节型板块都有 catalog 目录与池，` +
      `且 catalog/ 下没有未注册的目录`,
  )
}

if (exitCode === 0) {
  console.log('[verify:sections] 通过：新增板块只需 registry.yaml 的 sections 段 + 内容目录。')
}
process.exit(exitCode)
