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
  languageMetaSchema,
  registrySchema,
  scopedGlossarySchema,
  scopedPitfallSchema,
  scopedRoadmapStageSchema,
  snippetFileSchema,
  type Annotation,
  type Chapter,
  type LanguageMeta,
  type Registry,
  type ScopedGlossary,
  type ScopedPitfall,
  type ScopedRoadmapStage,
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
/** 一个覆盖层文件装载后的结果：它承载哪个 topic、里面有哪些实现 */
export interface SnippetFileGroup {
  /** 相对仓库根的路径，用于错误定位 */
  file: string
  topic: string
  items: SnippetSource[]
}

function yamlFilesIn(dir: string): string[] {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.yaml'))
    .map((d) => path.join(dir, d.name))
    .sort()
}

/**
 * 装载一门语言的覆盖层，保留「哪条来自哪个文件」的信息（错误定位要用）。
 *
 * 目录约定（推荐第一种）：
 *   content/languages/<id>/snippets/<topicId>/<NN>-<chapter>.yaml   按 topic 分目录
 *   content/languages/<id>/snippets/<NN>-<chapter>.yaml             平铺（旧布局，仍支持）
 *   content/languages/<id>/snippets.yaml                            单文件（语言内容少时够用）
 *
 * 为什么要有 topic 这一层：平铺布局里文件名必须自己携带 topic 信息
 * （实测出现过 `13-basics-python-01-variables.yaml` 这种把 topic 名与章节名拼在一起的名字），
 * 而序号是**语言目录内的局部序号**，同一序号在不同语言下指向不同 topic。
 * 分目录之后，文件名只表达「第几章」，归属由目录表达。
 */
export function loadSnippetFiles(id: string): SnippetFileGroup[] {
  const dir = path.join(LANGUAGES_DIR, id)
  const files: string[] = []

  const single = path.join(dir, 'snippets.yaml')
  if (exists(single)) files.push(single)

  const splitDir = path.join(dir, 'snippets')
  if (exists(splitDir)) {
    for (const entry of fs
      .readdirSync(splitDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) files.push(...yamlFilesIn(path.join(splitDir, entry.name)))
      else if (entry.name.endsWith('.yaml')) files.push(path.join(splitDir, entry.name))
    }
  }

  return files.map((file) => {
    const rel = path.relative(ROOT, file)
    const parsed = snippetFileSchema.parse(readYaml(file))
    const items = parsed.snippets.map((entry) => {
      // 条目级 review 覆盖文件级默认 —— 同批生成的条目共用一份 provenance 时，
      // 文件级写一次即可（全仓库曾因此重复 456 处）
      const review = entry.review ?? parsed.review
      if (!review) {
        throw new Error(
          `${rel}：featureId '${entry.featureId}' 既没有条目级 review，文件级也没有默认 review`,
        )
      }
      return { ...entry, review }
    })
    return { file: rel, topic: parsed.topic, items }
  })
}

/** 扁平形式 —— 只要实现、不关心它来自哪个文件时的入口 */
export function loadSnippets(id: string): SnippetSource[] {
  return loadSnippetFiles(id).flatMap((g) => g.items)
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

function loadArray(file: string): unknown[] {
  if (!exists(file)) return []
  const raw = readYaml(file)
  return Array.isArray(raw) ? raw : []
}

/** 一个 (基准, 目标) 对目录下的三份列表资源 */
export interface PairLists {
  topicId: string
  baseline: string
  target: string
  dir: string
  pitfalls: ScopedPitfall[]
  glossary: ScopedGlossary[]
  roadmaps: ScopedRoadmapStage[]
}

/** topics 目录下实际存在的目录名（章节目录与对目录混在一起，靠 registry 区分） */
export function listTopicIds(): string[] {
  return listDirs(TOPICS_DIR)
}

/**
 * 装载全部对级列表资源（陷阱 / 词典 / 路线）。
 *
 * 归属**由目录名反查 registry 得到**，不写进每条 YAML：同一条陷阱可能在多个
 * 方向上都成立，逐条写 pair 字段会立刻产生 12 份会各自漂移的副本。
 * 目录名对不上 registry 的（写错、或被停用）在这里被 R5 拦住，而不是静默不渲染。
 */
export function loadPairLists(registry: Registry): PairLists[] {
  const out: PairLists[] = []
  for (const [topicId, cfg] of Object.entries(registry.topics)) {
    if (cfg.section === 'basics' || !cfg.target) continue
    const dir = path.join(TOPICS_DIR, topicId)
    if (!exists(dir)) continue
    const ctx = { baseline: cfg.baseline, target: cfg.target }
    out.push({
      topicId,
      ...ctx,
      dir,
      pitfalls: loadArray(path.join(dir, 'pitfalls.yaml')).map((x) =>
        scopedPitfallSchema.parse({ ...(x as object), ...ctx }),
      ),
      glossary: loadArray(path.join(dir, 'glossary.yaml')).map((x) =>
        scopedGlossarySchema.parse({ ...(x as object), ...ctx }),
      ),
      roadmaps: loadArray(path.join(dir, 'roadmap.yaml'))
        .map((x) => scopedRoadmapStageSchema.parse({ ...(x as object), ...ctx }))
        .sort((a, b) => a.order - b.order),
    })
  }
  return out.sort((a, b) => a.topicId.localeCompare(b.topicId))
}

export function loadI18n(): Record<string, unknown> {
  const f = path.join(CONTENT_DIR, 'i18n', 'zh-CN.yaml')
  return exists(f) ? (readYaml(f) as Record<string, unknown>) : {}
}

/* ────────────────────────── @note 抽取 ────────────────────────── */

const NOTE_RE = /@note(!)?\s+/

export interface ExtractResult {
  /** 已剥离 @note 标记的代码（用于展示与复制）。高危项额外带一个 `⚠` 前缀 */
  code: string
  /** 高危注记（`@note!`），tone 恒为 'warn'。**说明已内联进 code**，这里留一份结构化副本 */
  notes: Annotation[]
  /** 全部注记（高危 + 普通），供搜索索引与构建期校验使用 */
  allNotes: Annotation[]
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
 * 两种语气的**说明都留在代码行内**，贴着那一行读，不另设说明栏 —— 把高危项单独抽到
 * 代码块下方，读者得在两处之间来回跳，反而切断阅读。高危（`@note!`）的差别只在说明前
 * 多一个 `⚠`，让它在满屏注释里能被一眼扫到；标记字符随 code 一起复制。
 * 标记本身（`@note` / `@note!`）无论哪种都照常剥掉。
 */
export function extractNotes(rawCode: string, commentLine: string): ExtractResult {
  const notes: Annotation[] = []
  const allNotes: Annotation[] = []
  const lines = rawCode.replace(/\r\n/g, '\n').split('\n')

  // 先量出 YAML 块标量自带的空行范围。抽取现在**原地保留注记行**（不再整行搬走），
  // 但块标量自身的首尾空行仍要裁掉，而裁剪只认这个剥离前的范围 —— 行数一变，
  // 行级 diff 与「就近阅读」依赖的行号就会整体错位。
  let head = 0
  while (head < lines.length && lines[head]!.trim() === '') head += 1
  let tail = lines.length
  while (tail > head && lines[tail - 1]!.trim() === '') tail -= 1

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
    const annotation: Annotation = { line: idx + 1, text, tone: bang ? 'warn' : 'info' }
    allNotes.push(annotation)
    if (bang) notes.push(annotation)

    const prefix = line.slice(0, ci + commentLine.length)

    /*
     * 两种语气都留在代码行内。**不能沿用旧的 `kept || text`** —— 那样
     * `// true —— @note 说明` 的说明会被 kept 顶掉，两个出口都不出现。
     *
     * 高危只在**说明文本**前加一个 `⚠`（不是整条注释的最前面）：注释正文（kept）保持原样，
     * 整行仍是「代码 // 正文 —— ⚠ 说明」的形状，读起来与普通注记无异，只是多一个可扫到的记号。
     * 说明为空时不落单一个 `⚠`（R4 已就「说明为空」报警，这里不给残尾）。
     */
    const lead = bang && text ? '⚠ ' : ''
    const body = kept ? `${kept} —— ${lead}${text}` : `${lead}${text}`
    return `${prefix}${body ? ` ${body}` : ''}`
  })

  // 只裁块标量自带的空行：注记行原地保留，抽取本身不再新增空行
  return { code: cleaned.slice(head, tail).join('\n'), notes, allNotes }
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
