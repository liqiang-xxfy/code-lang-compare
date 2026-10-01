/**
 * 生成语言注册表 —— src/generated/registry.gen.ts
 *
 * 为什么需要它（ADR-03）：
 *   v1 把 LanguageId 写成手写联合类型，于是「新增一门语言 = 只加数据目录，组件零改动」
 *   这句话是不成立的（至少得改类型文件）。现在：
 *     · allLanguageIds     ← 扫描 content/languages/<id>/meta.yaml，**内容源可引用任意一门**
 *     · enabledLanguageIds ← 由 content/registry.yaml 决定，**UI 只渲染已启用的**
 *   加语言只需加目录 + 在 registry 里注册，类型自动派生，没有任何手写代码要改。
 */
import path from 'node:path'
import type { LanguageMeta } from '../../src/schemas'
import {
  GENERATED_DIR,
  isPrivateLanguageDir,
  listLanguageIds,
  loadLanguageMeta,
  loadRegistry,
  writeText,
} from '../lib/core'

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
  const metas = dirIds.map((id) => loadLanguageMeta(id))

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

  if (!enabledLanguageIds.includes(registry.baseline)) {
    throw new Error(`registry.baseline = '${registry.baseline}' 未启用，基准语言必须是已启用的语言`)
  }
  const baselineCount = metas.filter((m) => m.baseline).length
  if (baselineCount > 1) {
    throw new Error(`有 ${baselineCount} 门语言在 meta 里标了 baseline: true，只能有一门`)
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
    `export const baselineLanguageId = ${q(registry.baseline)} as const`,
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
  const r = generateRegistry()
  console.log(
    `[registry] 全集 ${r.allLanguageIds.length} 门：${r.allLanguageIds.join(', ')}\n` +
      `[registry] 已启用：${r.enabledLanguageIds.join(', ')}\n` +
      `[registry] 已写入 src/generated/registry.gen.ts`,
  )
}
