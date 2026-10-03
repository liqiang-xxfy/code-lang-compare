/**
 * 生成语言注册表 —— src/generated/registry.gen.ts
 *
 * 为什么需要它（ADR-03）：
 *   v1 把 LanguageId 写成手写联合类型，于是「新增一门语言 = 只加数据目录，组件零改动」
 *   这句话是不成立的（至少得改类型文件）。现在：
 *     · allLanguageIds     ← 扫描 content/languages/<id>/meta.yaml，**内容源可引用任意一门**
 *     · enabledLanguageIds ← 由 content/registry.yaml 决定，**UI 只渲染已启用的**
 *   加语言只需加目录 + 在 registry 里注册，类型自动派生，没有任何手写代码要改。
 *
 * 数组的**顺序**同样来自 registry.yaml —— 那是界面上的显示顺序（ADR-58），
 * 与目录名无关。基准候选、对比语言勾选条、矩阵列、首页基准卡全按它排。
 */
import path from 'node:path'
import type { LanguageMeta } from '../../src/schemas'
import {
  GENERATED_DIR,
  isPrivateLanguageDir,
  listLanguageIds,
  loadLanguageMeta,
  loadRegistry,
  sortByDeclaredOrder,
  writeText,
} from '../lib/core'
import { generateSections } from './generate-sections'

export interface RegistryGenResult {
  allLanguageIds: string[]
  enabledLanguageIds: string[]
  meta: LanguageMeta[]
}

export interface RegistryGenOptions {
  /**
   * 是否把 `_` 开头的私有目录（脚手架模板 / CI 临时语言）也算进 allLanguageIds。
   * 默认 false —— 正常构建里它们必须隐形；只有 verify:ext 才会打开。
   */
  includePrivate?: boolean
  /** 是否把结果写进 src/generated/registry.gen.ts（默认 true）。探测场景传 false，避免留下中间态产物。 */
  write?: boolean
}

export function generateRegistry(options: RegistryGenOptions = {}): RegistryGenResult {
  const { includePrivate = false, write = true } = options
  const registry = loadRegistry()
  const publicIds = listLanguageIds()
  const privateIds = listLanguageIds({ includePrivate: true }).filter(isPrivateLanguageDir)
  const dirIds = includePrivate ? [...publicIds, ...privateIds].sort() : publicIds
  /*
   * 顺序 = registry.yaml 的声明顺序（ADR-58）。**在装载之后重排**，而不是先按
   * 声明的 id 列表去装载：后者遇到「登记了但目录不在」时会先抛出 ENOENT，
   * 把下面那条 R8 口径的人话报错盖掉。
   */
  const metas = sortByDeclaredOrder(dirIds.map((id) => loadLanguageMeta(id)))

  // 一致性检查：只对「公开」语言做。
  // 私有目录（_template / _fixturelang）本来就不该出现在 registry 里。
  const missingInRegistry = publicIds.filter((id) => !(id in registry.languages))
  const missingDir = Object.keys(registry.languages).filter((id) => !publicIds.includes(id))
  if (missingInRegistry.length) {
    throw new Error(
      `以下语言有 meta.yaml 但未在 content/registry.yaml 注册：${missingInRegistry.join(', ')}`,
    )
  }
  if (missingDir.length) {
    throw new Error(
      `以下语言在 content/registry.yaml 登记了但找不到 content/languages/<id>/meta.yaml：${missingDir.join(', ')}`,
    )
  }

  const allLanguageIds = metas.map((m) => m.id)
  const enabledLanguageIds = allLanguageIds.filter((id) => registry.languages[id]?.enabled)

  /**
   * 基准候选集合 —— 从各语言 meta 派生。
   *
   * 注意与 analyze.ts 的 R8 保持同一判据：那边是校验闸门（产出 error 列表），
   * 这边是代码生成（必须抛错终止）。两处判据不一致时会出现
   * 「校验放行但注册表 throw」这种最难查的组合，改动务必同步。
   */
  const baselineCandidateIds = metas.filter((m) => m.baseline).map((m) => m.id)

  if (!baselineCandidateIds.length) {
    throw new Error(
      '没有任何语言在 meta.yaml 里标了 baseline: true —— 至少要有一门基准候选，否则无从选择参照系',
    )
  }
  const disabledCandidates = baselineCandidateIds.filter((id) => !enabledLanguageIds.includes(id))
  if (disabledCandidates.length) {
    throw new Error(
      `以下语言标了 baseline: true 但未启用：${disabledCandidates.join(', ')}。基准候选必须是已启用语言`,
    )
  }
  if (!baselineCandidateIds.includes(registry.defaultBaseline)) {
    throw new Error(
      `registry.defaultBaseline = '${registry.defaultBaseline}' 不在基准候选里` +
        `（候选：${baselineCandidateIds.join(', ')}）—— 请在它的 meta.yaml 里标 baseline: true`,
    )
  }
  if (!enabledLanguageIds.includes(registry.defaultCompareLanguage)) {
    throw new Error(
      `registry.defaultCompareLanguage = '${registry.defaultCompareLanguage}' 未启用，默认对比语言必须是已启用的语言`,
    )
  }
  if (registry.defaultCompareLanguage === registry.defaultBaseline) {
    throw new Error(
      `registry.defaultCompareLanguage 与 defaultBaseline 同为 '${registry.defaultBaseline}' —— ` +
        '对比列必须有一门不同于基准的语言',
    )
  }

  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const arr = (xs: string[]) => xs.map(q).join(', ')

  const banner = [
    '/* eslint-disable */',
    '/*',
    ' * AUTO-GENERATED FILE — 请勿手工编辑。',
    ' * 源：content/registry.yaml + content/languages/<id>/meta.yaml',
    ' * 重新生成：npm run registry（npm run content:build 会自动执行）',
    ` * 生成时间：${new Date().toISOString()}`,
    ' */',
    "import type { LanguageMeta } from '../schemas'",
    '',
  ].join('\n')

  const body = [
    `export const allLanguageIds = [${arr(allLanguageIds)}] as const`,
    `export const enabledLanguageIds = [${arr(enabledLanguageIds)}] as const`,
    '',
    '/** 全集：内容源（snippets.yaml）可以引用任意一门，哪怕是尚未启用的语言——这支持「先攒内容后启用」 */',
    'export type AllLanguageId = (typeof allLanguageIds)[number]',
    'export type LanguageId = AllLanguageId',
    '/** 已启用：UI 只渲染这些列 */',
    'export type EnabledLanguageId = (typeof enabledLanguageIds)[number]',
    '',
    `export const publishPolicy = ${q(registry.publishPolicy)} as const`,
    '/** 首访默认值与 SSG 静态文案使用的基准 */',
    `export const defaultBaselineLanguageId = ${q(registry.defaultBaseline)} as const`,
    '/** 可作基准的语言（由各语言 meta.yaml 的 baseline: true 派生）。基准选择器只列这些 */',
    `export const baselineLanguageIds = [${arr(baselineCandidateIds)}] as const`,
    '/** 首访时对比列默认选中的语言。必须已启用且 ≠ 默认基准 */',
    `export const defaultCompareLanguageId = ${q(registry.defaultCompareLanguage)} as const`,
    '/** 默认对比语言的显示名 —— 供静态文案使用，免去每处再查一次 meta */',
    `export const defaultCompareLanguageName = ${q(
      metas.find((m) => m.id === registry.defaultCompareLanguage)?.name ?? registry.defaultCompareLanguage,
    )} as const`,
    '',
    'export const siteInfo = {',
    `  name: ${q(registry.site.name)},`,
    `  shortDescription: ${q(registry.site.shortDescription)},`,
    `  lang: ${q(registry.site.lang)},`,
    '} as const',
    '',
    `export const languageMeta: LanguageMeta[] = ${JSON.stringify(metas, null, 2)}`,
    '',
    'export const enabledLanguageMeta = languageMeta.filter((m): m is LanguageMeta =>',
    '  (enabledLanguageIds as readonly string[]).includes(m.id),',
    ')',
    '',
    'export function getLanguageMeta(id: string): LanguageMeta | undefined {',
    '  return languageMeta.find((m) => m.id === id)',
    '}',
    '',
    'export const isLanguageEnabled = (id: string): boolean =>',
    '  (enabledLanguageIds as readonly string[]).includes(id)',
    '',
  ].join('\n')

  if (write) writeText(path.join(GENERATED_DIR, 'registry.gen.ts'), banner + body)
  return { allLanguageIds, enabledLanguageIds, meta: metas }
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (isMain) {
  // 板块清单与语言清单同源（都来自 registry.yaml），一次命令刷新两份产物
  const sectionIds = generateSections()
  const r = generateRegistry()
  console.log(`[sections] 已注册 ${sectionIds.length} 个板块：${sectionIds.join(' → ')}`)
  console.log(
    `[registry] 全集 ${r.allLanguageIds.length} 门：${r.allLanguageIds.join(', ')}\n` +
      `[registry] 已启用：${r.enabledLanguageIds.join(', ')}\n` +
      `[registry] 已写入 src/generated/registry.gen.ts 与 sections.gen.ts`,
  )
}
