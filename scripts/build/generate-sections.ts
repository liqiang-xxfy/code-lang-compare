/**
 * 生成板块 id 清单 —— src/generated/sections.gen.ts
 *
 * 为什么需要它：
 *   板块曾是写死的枚举（`z.enum(['basics', ...])`），于是加板块要改散落的 17 处代码。
 *   现在板块是**数据**（`content/registry.yaml` 的 `sections:` 段），但类型仍要有人给 ——
 *   否则 `z.infer` 出的 `Section` 退化成 `string`，所有 `section: Section` 的赋值
 *   都失去检查。生成的联合类型补上这一环，与 `LanguageId` 是同一手法（ADR-03）。
 *
 * 为什么**零 import**：
 *   `src/schemas/index.ts` 要 import 本文件的类型，而 schemas 又被
 *   `scripts/lib/core.ts` 运行时 import。本文件若反向依赖 core，运行时就成环。
 *   所以这里直接用 fs + js-yaml 读 registry.yaml，不经过 core，也不 import schemas。
 *
 * 为什么**不用 z.enum(SECTION_IDS)** 做成员校验（一个踩过的坑）：
 *   CI 的顺序是 `content:validate → ... → content:build`，而本文件只在 build 阶段生成。
 *   若校验依赖生成物，`content:validate` 就会用**上一版**的 id 清单去校验**新**的
 *   registry.yaml —— 新增板块会以「invalid enum value」失败，而真正的生成步骤还没跑。
 *   因此：成员资格由 `registrySchema.superRefine` 读**当次解析的 YAML** 判定，
 *   本文件只负责类型。两者的一致性由 tests/unit/section-registry.test.ts 断言。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REGISTRY_FILE = path.join(ROOT, 'content', 'registry.yaml')
const OUT_FILE = path.join(ROOT, 'src', 'generated', 'sections.gen.ts')

export interface SectionsGenOptions {
  /** 是否写盘（默认 true）。探测场景传 false，避免留下中间态产物。 */
  write?: boolean
}

/** 读 registry.yaml 的 sections 键，按 order 排序 */
export function readSectionIds(): string[] {
  const raw = yaml.load(fs.readFileSync(REGISTRY_FILE, 'utf8')) as {
    sections?: Record<string, { order?: number }>
  }
  const sections = raw?.sections
  if (!sections || typeof sections !== 'object') {
    throw new Error(
      'content/registry.yaml 缺少 sections 段 —— 板块注册表是左栏分组、URL 段与 SEO 文案的唯一来源',
    )
  }
  const ids = Object.keys(sections)
  if (!ids.length) throw new Error('content/registry.yaml 的 sections 段为空')
  return ids.sort((a, b) => (sections[a]?.order ?? 0) - (sections[b]?.order ?? 0))
}

export function generateSections(options: SectionsGenOptions = {}): string[] {
  const { write = true } = options
  const ids = readSectionIds()

  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const body = [
    '/* eslint-disable */',
    '/*',
    ' * AUTO-GENERATED FILE — 请勿手工编辑。',
    ' * 源：content/registry.yaml 的 sections 段',
    ' * 重新生成：npm run registry（npm run content:build 会自动执行）',
    ` * 生成时间：${new Date().toISOString()}`,
    ' */',
    '',
    '/** 全部已注册板块，按 registry 的 order 排序。左栏顺序读它 */',
    `export const SECTION_IDS = [${ids.map(q).join(', ')}] as const`,
    '',
    '/**',
    ' * 板块 id 的联合类型。',
    ' *',
    ' * 这是**唯一**的板块类型来源 —— `src/schemas` 的 `Section` 就是它的别名。',
    ' * 它随 registry.yaml 的 sections 段自动更新，因此「加一个板块」不需要改任何类型代码。',
    ' */',
    'export type SectionId = (typeof SECTION_IDS)[number]',
    '',
    '/** 运行时判定：这个字符串是不是一个已注册的板块（路由守卫分流用） */',
    'export const isSectionId = (v: string): v is SectionId =>',
    '  (SECTION_IDS as readonly string[]).includes(v)',
    '',
  ].join('\n')

  if (write) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
    fs.writeFileSync(OUT_FILE, body, 'utf8')
  }
  return ids
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (isMain) {
  const ids = generateSections()
  console.log(`[sections] 已注册 ${ids.length} 个板块：${ids.join(' → ')}`)
  console.log('[sections] 已写入 src/generated/sections.gen.ts')
}
