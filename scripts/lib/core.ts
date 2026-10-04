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
  baselineCatalogSchema,
  featurePoolSchema,
  languageContentFileSchema,
  languageMetaSchema,
  pairMetaSchema,
  registrySchema,
  scopedGlossarySchema,
  scopedPitfallSchema,
  scopedRoadmapStageSchema,
  type Annotation,
  type BaselineCatalog,
  type BoxSource,
  type FeaturePool,
  type LanguageMeta,
  type PairMeta,
  type Registry,
  type ScopedGlossary,
  type ScopedPitfall,
  type ScopedRoadmapStage,
} from '../../src/schemas'

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CONTENT_DIR = path.join(ROOT, 'content')
export const LANGUAGES_DIR = path.join(CONTENT_DIR, 'languages')
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
export function isPrivateDir(id: string): boolean {
  return id.startsWith('_')
}

export function isPrivateLanguageDir(id: string): boolean {
  return isPrivateDir(id)
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

/**
 * 语言按 **registry.yaml 里 `languages:` 段的声明顺序**排（ADR-58）。
 *
 * 为什么顺序要有单一真源：它会**直接出现在界面上** —— 基准选择器、对比语言
 * 勾选条、矩阵的列、首页三张基准卡都按它排。曾经按目录名字母序，
 * 于是界面成了 Java / JS / Py、Go 排在 Python 前面；而「哪门在前更好读」
 * 是内容判断，不是文件系统的属性，该由人写在注册表里。
 *
 * 未在注册表里声明的（`_` 私有目录、`verify:ext` 造的临时语言）排在末尾，
 * 相互之间保持传入顺序 —— `Array#sort` 是稳定的，不必额外写比较器。
 *
 * ⚠ 与 [scripts/build/generate-registry.ts] 是**同一套判据**：那边写进
 * `registry.gen.ts`，这边喂校验与报告。两处分叉就会出现「报告里的顺序
 * 与页面上的顺序不一致」这种要对着看才发现的错。
 */
export function sortByDeclaredOrder<T extends { id: string }>(metas: T[]): T[] {
  const rank = declaredLanguageRanker()
  return metas.slice().sort((a, b) => rank(a.id) - rank(b.id))
}

/** registry 里 `languages` 段的声明顺序 —— **书写序即显示序**（ADR-58） */
function declaredLanguageOrder(): string[] {
  // 缓存：一次进程里 registry.yaml 不会变，而这个函数会在排序里被反复取用
  declaredOrderCache ??= Object.keys(loadRegistry().languages)
  return declaredOrderCache
}
let declaredOrderCache: string[] | null = null

/**
 * 给语言 id 求它在书写序里的位次；未声明的排到最后。
 *
 * **取一次、别放进比较函数里** —— 位次函数本身很便宜，但重复构造它就要重复读注册表。
 */
export function declaredLanguageRanker(): (id: string) => number {
  return rankerOf(declaredLanguageOrder())
}

function rankerOf(declared: readonly string[]): (id: string) => number {
  return (id) => {
    const i = declared.indexOf(id)
    return i === -1 ? declared.length : i
  }
}

export function loadAllLanguageMeta(): LanguageMeta[] {
  return sortByDeclaredOrder(listLanguageIds().map(loadLanguageMeta))
}

function loadArray(file: string): unknown[] {
  if (!exists(file)) return []
  const raw = readYaml(file)
  return Array.isArray(raw) ? raw : []
}

/**
 * 一个方向的 `meta.yaml` —— 速查内容的来源与校对留痕（ADR-66）。
 *
 * **缺失是合法的**：刚刚建立的方向目录、以及私有目录，都不该因为还没补留痕就让构建失败。
 * 但文件存在却解析不过就抛 —— 那说明写错了，和三个内容文件对形状的态度一致。
 */
function loadPairMeta(file: string): PairMeta | undefined {
  if (!exists(file)) return undefined
  return pairMetaSchema.parse(readYaml(file))
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

/* ────────────────────────── 内容装载 ──────────────────────────
 *
 * 目标形态见 docs/完整项目架构.md §2.5。清单是**两层**的：
 *   · `catalog/<板块>/features.yaml`            —— 知识点池，与基准无关
 *   · `catalog/<板块>/<基准 id>.yaml`            —— 该基准的章节分组
 * 两层之间靠 `group`（存放组）接缝，内容的归属因此与展示解耦。
 */

/**
 * 读一个语言内容文件并补齐 `review`（文件级默认 → 条目级覆盖）。
 *
 * 与文件级 `review` 的手法一致：整个存放组的 `state` 相同时，
 * 文件级写一次即可（全仓库曾因此重复几百处）。
 */
function readLanguageBoxesFile(file: string): { rel: string; boxes: Record<string, BoxSource> } {
  const rel = path.relative(ROOT, file)
  const parsed = languageContentFileSchema.safeParse(readYaml(file))
  if (!parsed.success) {
    throw new Error(
      `语言内容解析失败：${rel}\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    )
  }
  const boxes: Record<string, BoxSource> = {}
  for (const [featureId, entry] of Object.entries(parsed.data.boxes)) {
    const review = entry.review ?? parsed.data.review
    if (!review) {
      throw new Error(`${rel}：「${featureId}」既没有条目级 review，文件级也没有默认 review`)
    }
    boxes[featureId] = { ...entry, review }
  }
  return { rel, boxes }
}

/**
 * 列出语言目录里**实际存在**的内容文件，不做清单驱动。
 *
 * 用途单一：供分析期检测「有文件但不在池里」（拼错的板块目录 / 存放组名）。
 * 显式跳过 `snippets/`（v1 布局的残留约定）与 `_` 前缀目录。
 */
export function listLanguageGroupFiles(
  langId: string,
): Array<{ file: string; section: string; group: string }> {
  const dir = path.join(LANGUAGES_DIR, langId)
  const out: Array<{ file: string; section: string; group: string }> = []
  for (const section of listDirs(dir)) {
    if (isPrivateDir(section) || section === 'snippets') continue
    for (const file of listFiles(path.join(dir, section))) {
      out.push({
        file: path.relative(ROOT, file),
        section,
        group: path.basename(file, '.yaml'),
      })
    }
  }
  return out
}

export const CATALOG_DIR = path.join(CONTENT_DIR, 'catalog')
export const PAIRS_DIR = path.join(CONTENT_DIR, 'pairs')

/** 装载期发现的问题。是 error 还是 warn 由分析期判，这里只如实上报。 */
export interface LoadIssue {
  /** 相对仓库根的路径，用于错误定位 */
  where: string
  message: string
}

/* ────────────────── v2.1 清单：池 + 每基准分组（S6.5，只新增） ──────────────────
 *
 * 目标形态见 docs/完整项目架构.md §2.5。与上面那套「一份板块一份清单」**并列存在**到 S6.5c，
 * 那之前两条管线并存：旧 loader 只读 `catalog/*.yaml`（顶层单文件）与
 * `languages/<id>/<板块>/<展示章>.yaml`，对新目录 `catalog/<板块>/` 完全不可见。
 */

/** 某个 (板块, 存放组) 下的语言内容文件 —— `languages/<语言>/<板块>/<group>.yaml` */
export interface LanguageGroupContent {
  /** 相对仓库根的路径，用于错误定位 */
  file: string
  lang: string
  section: string
  /** 存放组 = 文件名（去扩展名）。**不是展示章** —— 展示章随基准变，这个不随 */
  group: string
  boxes: Record<string, BoxSource>
}

/** 池里出现过的全部存放组（去重，保持首次出现的顺序） */
export function groupsOfPool(pool: FeaturePool): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of pool.features) {
    if (seen.has(f.group)) continue
    seen.add(f.group)
    out.push(f.group)
  }
  return out
}

/**
 * feature 池：`content/catalog/<板块>/features.yaml`。
 *
 * 一个板块只有一个池 —— 它回答「这个板块有哪些知识点」，与基准无关。
 */
export function loadFeaturePools(): { pools: FeaturePool[]; issues: LoadIssue[] } {
  const pools: FeaturePool[] = []
  const issues: LoadIssue[] = []
  for (const section of listDirs(CATALOG_DIR)) {
    if (isPrivateDir(section)) continue
    const dir = path.join(CATALOG_DIR, section)
    const file = path.join(dir, 'features.yaml')
    const rel = path.relative(ROOT, file)
    if (!exists(file)) {
      // 目录里有 yaml、却没有池 —— 那些文件里的引用无处解析
      if (listFiles(dir).length) {
        issues.push({
          where: rel,
          message: `目录 '${section}/' 缺 features.yaml —— 章节分组引用的知识点无处解析`,
        })
      }
      continue
    }
    const parsed = featurePoolSchema.safeParse(readYaml(file))
    if (!parsed.success) {
      throw new Error(
        `feature 池解析失败：${rel}\n${parsed.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      )
    }
    // 目录名即板块 id。不一致时上报而不抛 —— 交给分析期判级（沿用手法）
    if (parsed.data.section !== section) {
      issues.push({
        where: rel,
        message: `目录名「${section}」与 section 字段「${parsed.data.section}」不一致`,
      })
    }
    pools.push(parsed.data)
  }
  return { pools, issues }
}

/**
 * 各基准的章节分组：`content/catalog/<板块>/<基准 id>.yaml`。
 *
 * 文件缺失 = 该基准在这个板块还没有章节（未开工），**不是错误**，因此不报 issue。
 * 文件名不是已知基准候选时才是问题：拼错会让整节内容静默消失。
 */
export function loadBaselineCatalogs(
  knownBaselineIds: readonly string[],
): { catalogs: BaselineCatalog[]; issues: LoadIssue[] } {
  const catalogs: BaselineCatalog[] = []
  const issues: LoadIssue[] = []
  const known = new Set(knownBaselineIds)
  for (const section of listDirs(CATALOG_DIR)) {
    if (isPrivateDir(section)) continue
    for (const file of listFiles(path.join(CATALOG_DIR, section))) {
      const name = path.basename(file, '.yaml')
      if (name === 'features') continue
      const rel = path.relative(ROOT, file)
      if (!known.has(name)) {
        issues.push({
          where: rel,
          message: `文件名「${name}」不是已知的基准候选 —— 章节分组只能挂在基准语言上`,
        })
        continue
      }
      const parsed = baselineCatalogSchema.safeParse(readYaml(file))
      if (!parsed.success) {
        throw new Error(
          `章节分组解析失败：${rel}\n${parsed.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n')}`,
        )
      }
      if (parsed.data.section !== section) {
        issues.push({
          where: rel,
          message: `目录名「${section}」与 section 字段「${parsed.data.section}」不一致`,
        })
      }
      if (parsed.data.baseline !== name) {
        issues.push({
          where: rel,
          message: `文件名「${name}」与 baseline 字段「${parsed.data.baseline}」不一致`,
        })
      }
      catalogs.push(parsed.data)
    }
  }
  return { catalogs, issues }
}

/**
 * 装载一门语言的内容（**由池的存放组驱动**，S6.5）。
 *
 * 与 `loadLanguageContent`（由展示章驱动）的关键差别：文件第三段是 `group`，与基准无关。
 * 于是同一个 feature 无论被哪个基准分到哪一章，内容都只此一份。
 */
export function loadPoolLanguageContent(
  langId: string,
  pools: readonly FeaturePool[],
  options: { includePrivate?: boolean } = {},
): LanguageGroupContent[] {
  if (!options.includePrivate && isPrivateLanguageDir(langId)) return []
  const out: LanguageGroupContent[] = []
  for (const pool of pools) {
    for (const group of groupsOfPool(pool)) {
      const file = path.join(LANGUAGES_DIR, langId, pool.section, `${group}.yaml`)
      if (!exists(file)) continue
      const { rel, boxes } = readLanguageBoxesFile(file)
      out.push({ file: rel, lang: langId, section: pool.section, group, boxes })
    }
  }
  return out
}

/** 一个方向（`content/pairs/<基准>2<目标>/`）下的三份列表资源 */
export interface PairListsV2 {
  /** 相对仓库根的路径 */
  dir: string
  baseline: string
  target: string
  /** `meta.yaml` 的来源与校对留痕。文件不存在时为 undefined（合法） */
  meta?: PairMeta | undefined
  pitfalls: ScopedPitfall[]
  glossary: ScopedGlossary[]
  roadmaps: ScopedRoadmapStage[]
}

/**
 * 把一个 `pairs/` 下的目录名拆成 (基准, 目标)。
 *
 * **不能简单 split('2')** —— 语言 id 允许含数字，出现含 `2` 的 id 时，
 * 简单切分会把内容静默挂到错误的方向上。做法是在每个 `2` 位置各试切一次，
 * 只保留「前后两半都是已知语言 id」的那种；不是恰好一种就判为无法解析。
 */
function parsePairDirName(
  name: string,
  knownLanguageIds: readonly string[],
): { baseline: string; target: string } | null {
  const known = new Set(knownLanguageIds)
  const hits: Array<{ baseline: string; target: string }> = []
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] !== '2') continue
    const baseline = name.slice(0, i)
    const target = name.slice(i + 1)
    if (known.has(baseline) && known.has(target)) hits.push({ baseline, target })
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * 装载全部方向性内容（`content/pairs/`）—— 速查三兄弟是唯一保留方向性的内容，
 * 它们的主语本就是方向，塞不进任何单个语言目录。
 *
 * 归属**由目录名反查得到**，不写进每条 YAML（沿用旧决策）：同一条陷阱可能在多个
 * 方向上成立，逐条写 pair 字段会立刻产生多份各自漂移的副本。
 *
 * 结构沿用旧契约（顶层数组），因此三个 scoped schema 直接复用。
 */
export function loadPairListsV2(
  knownLanguageIds: readonly string[] = listLanguageIds(),
): { pairs: PairListsV2[]; issues: LoadIssue[] } {
  const pairs: PairListsV2[] = []
  const issues: LoadIssue[] = []
  for (const name of listDirs(PAIRS_DIR)) {
    if (isPrivateLanguageDir(name)) continue
    const dir = path.join(PAIRS_DIR, name)
    const rel = path.relative(ROOT, dir)
    const parsed = parsePairDirName(name, knownLanguageIds)
    if (!parsed) {
      issues.push({
        where: rel,
        message: '目录名无法拆成「基准 2 目标」—— 要求前后两半都是已知语言 id，且只有一种拆法',
      })
      continue
    }
    const ctx = { baseline: parsed.baseline, target: parsed.target }
    pairs.push({
      dir: rel,
      ...ctx,
      meta: loadPairMeta(path.join(dir, 'meta.yaml')),
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
  /*
   * 排序按**语言书写序**（registry 里 languages 段的声明顺序），不是目录名字典序。
   *
   * 这个顺序是可见的：左栏的方向列表，以及 `resolvePairTarget` 在「勾选里没有该基准
   * 可用的目标」时回落的 `available[0]`（ADR-67）。字典序在这里会选错 —— 补齐 12 个
   * 方向后，python 基准的可用集按字典序排成 [go, javascript, java, rust]，
   * 于是「以 Python 为基准」的读者打开速查默认看到的是「Python 迁 Go」。
   */
  const rank = rankerOf(declaredLanguageOrder())
  return {
    pairs: pairs.sort(
      (a, b) => rank(a.baseline) - rank(b.baseline) || rank(a.target) - rank(b.target),
    ),
    issues,
  }
}
