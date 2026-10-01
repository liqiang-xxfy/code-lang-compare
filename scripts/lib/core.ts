/**
 * 构建期公共工具：路径、YAML 读取、内容装载、@note 抽取。
 *
 * 这里的所有读取都只在 Node 侧发生（构建期）。浏览器端只读 src/generated/ 的产物——
 * 这是「构建期单一真源」的落地（ADR-01）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import {
  chapterSchema,
  conceptGroupSchema,
  glossaryTermSchema,
  languageMetaSchema,
  pitfallSchema,
  registrySchema,
  roadmapStageSchema,
  snippetFileSchema,
  type Annotation,
  type Chapter,
  type ConceptGroup,
  type GlossaryTerm,
  type LanguageMeta,
  type Pitfall,
  type Registry,
  type RoadmapStage,
  type SnippetSource,
} from '../../src/schemas'

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CONTENT_DIR = path.join(ROOT, 'content')
export const LANGUAGES_DIR = path.join(CONTENT_DIR, 'languages')
export const TOPICS_DIR = path.join(CONTENT_DIR, 'topics')
export const GENERATED_DIR = path.join(ROOT, 'src', 'generated')
export const PUBLIC_DIR = path.join(ROOT, 'public')

/* ────────────────────────── 基础 IO ────────────────────────── */

export function exists(p: string): boolean {
  return fs.existsSync(p)
}

export function readYaml<T = unknown>(file: string): T {
  return yaml.load(fs.readFileSync(file, 'utf8')) as T
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

export function listDirs(dir: string): string[] {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

export function listFiles(dir: string, ext = '.yaml'): string[] {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => path.join(dir, d.name))
    .sort()
}

/* ────────────────────────── 内容装载 ────────────────────────── */

export function loadRegistry(): Registry {
  return registrySchema.parse(readYaml(path.join(CONTENT_DIR, 'registry.yaml')))
}

/**
 * 私有目录约定：以 `_` 开头的语言目录默认不参与构建与校验。
 *
 * 为什么需要它：
 *  · `_template/` 是给作者复制用的脚手架，不该被当成一门真语言渲染出来
 *  · `verify:ext` 需要在真实目录树里造一门临时语言来证明「加语言只加数据」，
 *    但万一进程被中断，残留目录会让整个仓库的校验失败（实测踩到过，
 *    表现为测试间歇性失败，报 R8「有 meta.yaml 但未在 registry 注册」）
 */
export function isPrivateLanguageDir(id: string): boolean {
  return id.startsWith('_')
}

/** 语言「是否存在」由目录决定；「是否启用」由 registry 决定（单一开关）。 */
export function listLanguageIds(options: { includePrivate?: boolean } = {}): string[] {
  const ids = listDirs(LANGUAGES_DIR).filter((id) =>
    exists(path.join(LANGUAGES_DIR, id, 'meta.yaml')),
  )
  return options.includePrivate ? ids : ids.filter((id) => !isPrivateLanguageDir(id))
}

export function loadLanguageMeta(id: string): LanguageMeta {
  return languageMetaSchema.parse(readYaml(path.join(LANGUAGES_DIR, id, 'meta.yaml')))
}

export function loadAllLanguageMeta(): LanguageMeta[] {
  return listLanguageIds().map(loadLanguageMeta)
}

/**
 * 一门语言的实现可以放在两个位置，两者会被合并：
 *   · content/languages/<id>/snippets.yaml        单文件形式（语言内容少时够用）
 *   · content/languages/<id>/snippets/*.yaml      按章拆分形式（推荐）
 *
 * 为什么支持按章拆分：M1 有 8 章、每章 9 个 Feature，单文件会涨到千行以上，
 * 既不好 review（一次 PR 的 diff 覆盖整章），也不好并行编辑（同文件必冲突）。
 * 拆成「一章一文件」后，加一章内容 = 新增一个文件，diff 干净、冲突面最小。
 */
export function loadSnippets(id: string): SnippetSource[] {
  const dir = path.join(LANGUAGES_DIR, id)
  const files: string[] = []

  const single = path.join(dir, 'snippets.yaml')
  if (exists(single)) files.push(single)

  const splitDir = path.join(dir, 'snippets')
  if (exists(splitDir)) {
    files.push(
      ...fs
        .readdirSync(splitDir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.yaml'))
        .map((d) => path.join(splitDir, d.name))
        .sort(),
    )
  }

  return files.flatMap((file) => snippetFileSchema.parse(readYaml(file)))
}

/** 章节：content/topics/<topicId>/NN-*.yaml。列表型资源（数组）会被跳过。 */
export function loadChapters(): Chapter[] {
  const out: Chapter[] = []
  for (const topicId of listDirs(TOPICS_DIR)) {
    for (const file of listFiles(path.join(TOPICS_DIR, topicId))) {
      const raw = readYaml(file)
      if (Array.isArray(raw)) continue
      const parsed = chapterSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `章节解析失败：${path.relative(ROOT, file)}\n${parsed.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n')}`,
        )
      }
      out.push(parsed.data)
    }
  }
  return out.sort((a, b) => a.order - b.order)
}

function loadListFile<T>(rel: string): T[] {
  const f = path.join(CONTENT_DIR, rel)
  if (!exists(f)) return []
  const raw = readYaml(f)
  return Array.isArray(raw) ? (raw as T[]) : []
}

export function loadPitfalls(): Pitfall[] {
  return loadListFile<unknown>('topics/pitfalls/pitfalls.yaml').map((x) => pitfallSchema.parse(x))
}

export function loadConcepts(): ConceptGroup[] {
  return loadListFile<unknown>('topics/concepts/concepts.yaml').map((x) =>
    conceptGroupSchema.parse(x),
  )
}

export function loadGlossary(): GlossaryTerm[] {
  return loadListFile<unknown>('topics/concepts/glossary.yaml').map((x) =>
    glossaryTermSchema.parse(x),
  )
}

export function loadRoadmap(langId: string): RoadmapStage[] {
  const f = path.join(LANGUAGES_DIR, langId, 'roadmap.yaml')
  if (!exists(f)) return []
  const raw = readYaml(f)
  if (!Array.isArray(raw)) return []
  return raw.map((x) => roadmapStageSchema.parse(x)).sort((a, b) => a.order - b.order)
}

export function loadI18n(): Record<string, unknown> {
  const f = path.join(CONTENT_DIR, 'i18n', 'zh-CN.yaml')
  return exists(f) ? (readYaml(f) as Record<string, unknown>) : {}
}

/* ────────────────────────── @note 抽取 ────────────────────────── */

const NOTE_RE = /@note(!)?\s+/

export interface ExtractResult {
  /** 已剥离 @note 标记的代码（用于展示与复制） */
  code: string
  notes: Annotation[]
}

/**
 * 从代码里抽取内联 @note 标记（ADR-10）。
 *
 * 为什么不用「锚定行号」：行号会随代码编辑静默漂移，而内容准确性是最高风险项。
 * 内联标记强制作者在改代码时必然碰到注释，且与 hyperpolyglot 的呈现惯例一致。
 *
 * 标记必须落在「该语言自己的行注释」里（前缀由 meta.comment.line 决定），但在注释里的
 * 位置不限 —— 以下两种写法都支持：
 *
 *   let x = 1;        // @note 说明                        ← 标记后面就是说明
 *   Boolean([]);      // true —— @note! 空数组是真值         ← 注释有正文，标记追加说明
 *
 * `@note!` 表示高危（warn 语气）。渲染时标记本身会被去掉：
 *   · 注释里还有正文 → 保留正文，剥掉标记
 *   · 注释里只有标记 → 用说明文本作为注释正文
 */
export function extractNotes(rawCode: string, commentLine: string): ExtractResult {
  const notes: Annotation[] = []
  const lines = rawCode.replace(/\r\n/g, '\n').split('\n')

  const cleaned = lines.map((line, idx) => {
    const ci = line.indexOf(commentLine)
    if (ci === -1) return line

    const after = line.slice(ci + commentLine.length)
    const marker = NOTE_RE.exec(after)
    if (!marker) return line

    const bang = marker[1]
    const before = after.slice(0, marker.index)
    const text = after.slice(marker.index + marker[0].length).trim()

    // 标记前若只剩分隔符（`——`、`-`、`·`）一并清掉，避免留下「// true ——」这种残尾
    const kept = before.replace(/[\s·—–-]+$/, '').trim()
    const body = kept || text

    notes.push({ line: idx + 1, text, tone: bang ? 'warn' : 'info' })
    return line.slice(0, ci + commentLine.length) + (body ? ` ${body}` : '')
  })

  // 去掉首尾空行（YAML 块标量常带一个尾随换行）
  while (cleaned.length && cleaned[0]!.trim() === '') cleaned.shift()
  while (cleaned.length && cleaned[cleaned.length - 1]!.trim() === '') cleaned.pop()

  return { code: cleaned.join('\n'), notes }
}

/* ────────────────────────── 小工具 ────────────────────────── */

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function writeText(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data, 'utf8')
}

export function rmrf(dir: string): void {
  if (exists(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

/** URL 协议白名单（R7） */
export function isSafeUrl(u: string): boolean {
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}
