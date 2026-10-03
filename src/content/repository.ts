/**
 * ContentRepository —— 运行时取数契约。
 *
 * 为什么要有这层抽象：预渲染要求「任意路由能在 Node 里独立取数」，
 * 而客户端要按分片懒加载。两者共用同一组接口，视图层就完全不需要知道
 * 数据是从动态 import 来还是从 SSR 预加载里来。
 *
 * 分片粒度是**一门语言 × 一个存放组**（`generated/content/<语言>/<板块>/<存放组>.json`）。
 * 左栏与矩阵的行来自**该基准的章节分组** —— 章节分类每个基准各一份，
 * 所以「第一章叫什么、有哪些行」随基准变；而格子只由 (语言, feature) 决定，与基准无关。
 */
import attrsJson from '../generated/attributions.json'
import catalogJson from '../generated/catalog.json'
import i18nJson from '../generated/i18n.json'
import manifestJson from '../generated/manifest.json'
import type {
  AttributionEntry,
  CatalogChapter,
  Equivalence,
  FeatureKind,
  Manifest,
  PairPayload,
  RenderedBoxChapter,
  RenderedCatalog,
  Section,
  SectionDef,
} from '../schemas'

export interface AttributionPayload {
  generatedAt: string
  siteLicense: string
  entries: AttributionEntry[]
}

/** 搜索索引分片的形状（与 scripts/pipeline/search-index.ts 的 SearchIndexPayload 对应） */
export interface SearchShard {
  generatedAt: string
  lang: string
  docCount: number
  byType: Record<string, number>
  index: string
}

export const manifest = manifestJson as unknown as Manifest
export const catalog = catalogJson as unknown as RenderedCatalog
export const attributionPayload = attrsJson as unknown as AttributionPayload
export const i18nMessages = i18nJson as unknown as Record<string, unknown>

/* ────────────────── 板块（section）注册表 ────────────────── */

/**
 * 板块属性的**唯一读取口**。
 *
 * 这些判断此前散落成 `section === '...'` 字面量，并在四处被当作
 * 「是否基准级」的判据 —— 漏改不报错，页面只是静默按另一种形态渲染。
 * 现在统一读注册表，三个维度各归其位，互不推导：
 *   scope   有没有「方向」概念（决定要不要 resolvePairTarget）
 *   columns 语言控件是多选还是单选
 *   shape   章节型还是列表型（决定取章节分片还是列表分片）
 */
export function sectionDefOf(section: Section): (SectionDef & { id: Section }) | undefined {
  return manifest.sections.find((s) => s.id === section)
}

/** 该板块是否锁定「基准 → 目标」两门。基准级板块没有方向概念 */
export const sectionUsesTarget = (section: Section): boolean =>
  sectionDefOf(section)?.scope === 'pair'

/** 该板块的语言控件是否多选 —— 多选 = 多列并排，单选 = 一篇文章 */
export const sectionIsMulti = (section: Section): boolean =>
  sectionDefOf(section)?.columns === 'multi'

/** 该板块是否有章节。列表型板块只有一页列表资源 */
export const sectionIsChapter = (section: Section): boolean =>
  sectionDefOf(section)?.shape === 'chapter'

/** 全部板块，按 order —— 左栏与首页入口的顺序来源 */
export const orderedSections = (): ReadonlyArray<SectionDef & { id: Section }> => manifest.sections

/**
 * 特性在章节页里的锚点 id。
 *
 * 全局 feature id 是 `<板块>/<feature>` 两段，斜杠不能直接进 `#` 片段，整段换成连字符。
 * **用完整 id 而不是最后一段**：不同板块里同名的 slug 会撞在同一个锚点上。
 */
export const featureAnchor = (globalId: string): string =>
  `feature-${globalId.replace(/\//g, '-')}`

/** 特性详情页的地址 —— 全局 id 直接拼成路径（两段，与基准无关） */
export const featurePathOf = (globalId: string): string => `/feature/${globalId}`

/**
 * 第一个章节型板块（按 order）。
 *
 * 用在「要保持在同一类页面里」的回落：切基准时保留章节语境（useBaselineSwitch）、
 * 语言页的「以它为基准浏览」入口。它的语义是**形态**（第一个有章节的），
 * 不是「站点落点」—— 落点见下面的 `landingSection`。
 */
export const firstChapterSection = (): Section | null =>
  orderedSections().find((s) => s.shape === 'chapter')?.id ?? null

/**
 * 站点落点板块 —— `registry.yaml` 里声明 `landing: true` 的那个。
 *
 * 为什么是数据而不是写死一个板块名：站点落点是**策展决策**，换一个只该改
 * registry 一行；写死 id 还会迫使 `verify:sections` 的白名单多一条注解。
 */
export const landingSection = (): Section | null =>
  orderedSections().find((s) => s.landing)?.id ?? firstChapterSection()

/* ────────────────── 清单：每基准一份的章节分组 ────────────────── */

/**
 * 某基准在某板块下的章节 —— 顺序即数组顺序。
 *
 * **必须带基准**：章节分类是每个基准各一份的（ADR-52）。同名章节在不同基准下
 * 不代表同义；某个基准可能根本没有这个板块（返回空数组 = 未开工）。
 */
export const chaptersOf = (baseline: string, section: Section): CatalogChapter[] =>
  catalog.catalogs.find((c) => c.section === section && c.baseline === baseline)?.chapters ?? []

export const chapterOf = (
  baseline: string,
  section: Section,
  chapter: string,
): CatalogChapter | null => chaptersOf(baseline, section).find((c) => c.id === chapter) ?? null

/**
 * 某基准在某板块下**真正能打开的**章节 —— 判据是「该基准自己写了这一章引用的某个存放组」。
 *
 * **这是全站唯一的章节可见性判据**，必须与构建期的路由判据（`04-build` 的章节页判据）
 * 和路由守卫的 404 判据（`guards`）同源。骨架期**章节分类先于内容落库**
 * （清单一次列全、正文按批填），所以「章节列表」与「能打开的章节」是两件事 ——
 * 左栏二级、首页计数、上一章 / 下一章、板块入口全部走这个函数；
 * 任何一处漏了，那一处就会出现**点进去 404 的死链**（路由探针抓不到，因为不报错）。
 */
export const visibleChaptersOf = (baseline: string, section: Section): CatalogChapter[] =>
  chaptersOf(baseline, section).filter((c) => hasChapterContent(baseline, baseline, section, c.id))

/**
 * 某个 feature 在**该基准的**章节分类里落在哪一章。
 *
 * 可能返回 null —— 这个基准把该知识点取舍掉了（Python 视角下就没有「变量提升」这一行）。
 * 详情页用它决定面包屑里要不要带一层章节，**不能反过来要求 feature 有唯一的章**。
 */
export function chapterContaining(
  baseline: string,
  section: Section,
  featureId: string,
): CatalogChapter | null {
  return chaptersOf(baseline, section).find((c) => c.features.some((f) => f.id === featureId)) ?? null
}

/** 该基准在这个板块有没有章节 —— 没有就是「还没开工」，左栏整组隐藏 */
export const hasBaselineCatalog = (baseline: string, section: Section): boolean =>
  catalog.catalogs.some((c) => c.section === section && c.baseline === baseline)

export interface FeatureMeta {
  title: string
  section: Section
  /** 存放组 —— 内容分片的第三段 */
  group: string
  kind: FeatureKind
  summary?: string
  /** 软引用：写全局 id `<板块>/<feature>`，可跨板块 */
  refFeatureId?: string
  tags: string[]
}

/**
 * 全局 feature id → 元数据。key 形如 `<板块>/<feature>`。
 *
 * **没有「章」**：一个 feature 在不同基准下属于不同的章、甚至被某个基准取舍掉 ——
 * 它没有唯一的章。详情页也不需要章，它只需要存放组（内容与基准无关）。
 */
export const featureMetaOf = (globalId: string): FeatureMeta | undefined => catalog.featureIndex[globalId]

/** 某个 feature 的内容写在哪个存放组 */
export const groupOfFeature = (globalId: string): string | null =>
  catalog.featureIndex[globalId]?.group ?? null

/**
 * 某一章引用了哪些**存放组** —— 这一页要加载的内容分片就是它。
 *
 * 与构建期 `04-build.ts` 的同名函数**必须同判据**：那边用它决定「这一页值不值得产出」，
 * 这边用它决定「加载哪几份分片」。两边分叉 = 空白页且不报错。
 */
export function groupsOfChapter(baseline: string, section: Section, chapter: string): string[] {
  const ch = chapterOf(baseline, section, chapter)
  if (!ch) return []
  const out: string[] = []
  for (const f of ch.features) if (!out.includes(f.group)) out.push(f.group)
  return out
}

/**
 * 章内前后章（用于翻页）。章节顺序来自**该基准**的章节分组的数组顺序。
 *
 * 在**能打开的章节**里取前后 —— 否则「下一章」会指向一个还没写内容的章，点进去 404。
 */
export function siblingsOf(
  baseline: string,
  section: Section,
  chapter: string,
): { prev: CatalogChapter | null; next: CatalogChapter | null } {
  const list = visibleChaptersOf(baseline, section)
  const i = list.findIndex((c) => c.id === chapter)
  if (i < 0) return { prev: null, next: null }
  return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null }
}

/* ────────────────── 内容分片：一门语言 × 一个存放组 ────────────────── */

/**
 * 分片键 = `<语言>/<板块>/<存放组>`，与 `generated/content/` 下的目录结构、
 * 与 `languages/<语言>/<板块>/<存放组>.yaml` 一一对应。
 *
 * 两侧（构建期 emit 与这里）必须逐字一致 —— 错一个字符就是**整页空白且不报错**。
 */
const boxShards = import.meta.glob<RenderedBoxChapter>('../generated/content/**/*.json', {
  import: 'default',
})

/** 对级静态资源：`static/<baseline>--<target>.json`，键能从 (基准, 目标) 直接推出来 */
const pairShards = import.meta.glob<PairPayload>('../generated/static/*.json', { import: 'default' })

/** 搜索索引按语言分片，客户端按可见列加载对应的那几份 */
const searchShards = import.meta.glob<SearchShard>('../generated/search-index/*.json', {
  import: 'default',
})

const boxCache = new Map<string, RenderedBoxChapter>()
const pairCache = new Map<string, PairPayload>()
const searchCache = new Map<string, SearchShard>()

export const boxShardKeyOf = (lang: string, section: Section, group: string): string =>
  `${lang}/${section}/${group}`

export function boxShardPathOf(lang: string, section: Section, group: string): string {
  return `../generated/content/${lang}/${section}/${group}.json`
}

/** 取「某门语言在某个存放组」的分片。找不到返回 null。 */
export async function getBoxGroup(
  lang: string,
  section: Section,
  group: string,
): Promise<RenderedBoxChapter | null> {
  const key = boxShardKeyOf(lang, section, group)
  const cached = boxCache.get(key)
  if (cached) return cached
  const loader = boxShards[boxShardPathOf(lang, section, group)]
  if (!loader) return null
  const payload = await loader()
  boxCache.set(key, payload)
  return payload
}

/** 已加载则同步取，未加载返回 null —— 视图在守卫 ensure 之后用它渲染 */
export function getBoxGroupSync(
  lang: string,
  section: Section,
  group: string,
): RenderedBoxChapter | null {
  return boxCache.get(boxShardKeyOf(lang, section, group)) ?? null
}

/** 某个存放组有没有分片（不加载，只查 glob 键） */
export function hasBoxGroup(lang: string, section: Section, group: string): boolean {
  return Boolean(boxShards[boxShardPathOf(lang, section, group)])
}

/**
 * 某门语言在**某一章**里有没有内容 —— 该章引用的存放组里至少一个写了。
 *
 * 用途是**列裁剪**：勾选了一门完全没写这一章的语言时，与其给它一列空白，
 * 不如不显示这一列（不补位，ADR-34）。判据必须与构建期的路由判据同口径，
 * 否则会出现「导航里有、点进去整列留白」。
 */
export function hasChapterContent(
  lang: string,
  baseline: string,
  section: Section,
  chapter: string,
): boolean {
  return groupsOfChapter(baseline, section, chapter).some((g) => hasBoxGroup(lang, section, g))
}

/* ────────────────── (基准, 目标) 对 ────────────────── */

export const pairKey = (baseline: string, target: string): string => `${baseline}|${target}`

export function pairShardPathOf(baseline: string, target: string): string {
  return `../generated/static/${baseline}--${target}.json`
}

/** 懒加载一个方向的陷阱 / 词典 / 路线。返回 null 表示这个方向还没有内容。 */
export async function getPairPayload(
  baseline: string,
  target: string,
): Promise<PairPayload | null> {
  const key = pairKey(baseline, target)
  const cached = pairCache.get(key)
  if (cached) return cached
  const loader = pairShards[pairShardPathOf(baseline, target)]
  if (!loader) return null
  const payload = await loader()
  pairCache.set(key, payload)
  return payload
}

/** 已加载则同步取，未加载返回 null —— 视图在守卫 ensure 之后用它渲染 */
export function getPairPayloadSync(baseline: string, target: string): PairPayload | null {
  return pairCache.get(pairKey(baseline, target)) ?? null
}

export function getPair(baseline: string, target: string) {
  return manifest.pairs.find((p) => p.baseline === baseline && p.target === target) ?? null
}

/**
 * 该方向是否真的有这个板块的内容。
 *
 * 判断依据取自 manifest.pairs，与 routes / 预渲染 / sitemap 同源 ——
 * 因此不可能出现「导航里有、点进去是空的」这种死链。
 */
export function hasPairSection(baseline: string, target: string, section: Section): boolean {
  return getPair(baseline, target)?.sections.includes(section) ?? false
}

/** 某个基准下、某个板块里可去的目标语言（左栏二级与回落逻辑共用） */
export function pairTargetsOf(baseline: string, section: Section): string[] {
  return manifest.pairs
    .filter((p) => p.baseline === baseline && p.sections.includes(section))
    .map((p) => p.target)
}

/* ────────────────── 搜索索引分片 ────────────────── */

export async function getSearchShard(lang: string): Promise<SearchShard | null> {
  const cached = searchCache.get(lang)
  if (cached) return cached
  const loader = searchShards[`../generated/search-index/${lang}.json`]
  if (!loader) return null
  const payload = await loader()
  searchCache.set(lang, payload)
  return payload
}

/* ────────────────── 语言与语言入口 ────────────────── */

export function getAttributions(): AttributionPayload {
  return attributionPayload
}

/**
 * 章节 id → 它的规范 URL。前后翻页、面包屑、跳转回落全部走这一个函数。
 *
 * **URL 里没有目标语言**：速查板块的目标由页内的对比语言选择条决定。
 * 目标进 URL 会让同一份内容散成十几个地址，而它其实只是"我现在想看哪个方向"。
 *
 * 基准进 URL：每个基准是一套独立的浏览语境（**连章节分类都不同**），要能预渲染、能分享。
 */
export function chapterPathOf(baseline: string, section: Section, chapter: string): string {
  return `/compare/${baseline}/${section}/${chapter}`
}

/** 板块入口地址（不含目标语言） */
export function sectionPathOf(baseline: string, section: Section): string {
  return `/compare/${baseline}/${section}`
}

/**
 * 对级板块的**有效目标语言**。
 *
 * 目标不进 URL，所以每次渲染都要算一次"现在该看哪个方向"。规则按优先级：
 *   1. 用户**最近一次挑的**目标（刚在页内选择条里选了某门语言，页面就该跟着换）
 *   2. 已勾选语言里第一个该板块**确实有内容**的
 *   3. 该板块在 manifest 里的第一个可用方向
 *
 * 只有「确实有内容」的方向才会被选中 —— 否则会渲染出一个空页面，
 * 而用户完全不知道问题出在自己的选择上。
 */
export function resolvePairTarget(
  baseline: string,
  section: Section,
  selected: readonly string[],
  preferred?: string | null,
): string | null {
  const available = pairTargetsOf(baseline, section)
  if (!available.length) return null
  if (preferred && available.includes(preferred)) return preferred
  const picked = selected.find((id) => available.includes(id))
  return picked ?? available[0]!
}

export type { Equivalence }
