/**
 * ContentRepository —— 运行时取数契约（架构定稿 §3.4 / §7.1）。
 *
 * 为什么要有这层抽象：预渲染（D-B）要求「任意路由能在 Node 里独立取数」，
 * 而客户端要按 (语言, 板块, 章节) 分片懒加载。两者共用同一组接口，
 * 视图层就完全不需要知道数据是从动态 import 来还是从 SSR 预加载里来。
 *
 * v2 的分片粒度是**一门语言 × 一个章节**：一个章节页渲染 N 列，
 * 就按可见语言各取一份。清单（章节树与 feature 索引）与语言无关，
 * 走 eager import 的 `catalog.json` —— 它小，且每页都要用。
 */
import attrsJson from '../generated/attributions.json'
import catalogJson from '../generated/catalog.json'
import i18nJson from '../generated/i18n.json'
import manifestJson from '../generated/manifest.json'
import type {
  AttributionEntry,
  Catalog,
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
 * 全局 feature id 是 `<板块>/<章节>/<feature>` 三段，斜杠不能直接进 `#` 片段，
 * 所以整段换成连字符。**用完整 id 而不是最后一段**：不同章节里同名的 slug
 * （例：两章都有 `intro`）会撞在同一个锚点上。
 */
export const featureAnchor = (globalId: string): string =>
  `feature-${globalId.replace(/\//g, '-')}`

/** 特性详情页的地址 —— 全局 id 直接拼成路径 */
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

/* ────────────────── 清单（与语言无关） ────────────────── */

/** 某个板块的清单。章节型板块才有 */
export const catalogOf = (section: Section): Catalog | null =>
  catalog.catalogs.find((c) => c.section === section) ?? null

/** 某板块的全部章节（已按清单里的数组顺序）。章节与语言、基准都无关 */
export const chaptersOf = (section: Section): CatalogChapter[] => catalogOf(section)?.chapters ?? []

export const chapterOf = (section: Section, chapter: string): CatalogChapter | null =>
  chaptersOf(section).find((c) => c.id === chapter) ?? null

export interface FeatureMeta {
  title: string
  section: Section
  chapter: string
  kind: FeatureKind
}

/** 全局 feature id → 元数据。key 形如 `<板块>/<章节>/<feature>` */
export const featureMetaOf = (globalId: string): FeatureMeta | undefined => catalog.featureIndex[globalId]

/** 全局 feature 清单（按板块、章节、清单顺序展开） */
export function allFeatures(): Array<{ id: string; section: Section; chapter: string; title: string; kind: FeatureKind; summary?: string; refFeatureId?: string; tags: string[] }> {
  const out: ReturnType<typeof allFeatures> = []
  for (const c of catalog.catalogs) {
    for (const ch of c.chapters) {
      for (const f of ch.features) {
        out.push({
          id: `${c.section}/${ch.id}/${f.id}`,
          section: c.section as Section,
          chapter: ch.id,
          title: f.title,
          kind: f.kind,
          ...(f.summary ? { summary: f.summary } : {}),
          ...(f.refFeatureId ? { refFeatureId: f.refFeatureId } : {}),
          tags: f.tags,
        })
      }
    }
  }
  return out
}

/* ────────────────── 内容分片：一门语言 × 一个章节 ────────────────── */

/**
 * 分片键 = `<语言>/<板块>/<章节>`，与 `generated/content/` 下的目录结构、
 * 与 `languages/<语言>/<板块>/<章节>.yaml` 一一对应。
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

export const boxShardKeyOf = (lang: string, section: Section, chapter: string): string =>
  `${lang}/${section}/${chapter}`

export function boxShardPathOf(lang: string, section: Section, chapter: string): string {
  return `../generated/content/${lang}/${section}/${chapter}.json`
}

/** 取「某门语言在某章」的内容分片。找不到返回 null（路由层负责转 404）。 */
export async function getBoxChapter(
  lang: string,
  section: Section,
  chapter: string,
): Promise<RenderedBoxChapter | null> {
  const key = boxShardKeyOf(lang, section, chapter)
  const cached = boxCache.get(key)
  if (cached) return cached
  const loader = boxShards[boxShardPathOf(lang, section, chapter)]
  if (!loader) return null
  const payload = await loader()
  boxCache.set(key, payload)
  return payload
}

/** 已加载则同步取，未加载返回 null —— 视图在守卫 ensure 之后用它渲染 */
export function getBoxChapterSync(
  lang: string,
  section: Section,
  chapter: string,
): RenderedBoxChapter | null {
  return boxCache.get(boxShardKeyOf(lang, section, chapter)) ?? null
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

/** 侧边导航所需的最小树 —— 来自清单，与语言无关 */
export function getNavigation(): Array<{ section: Section; title: string; chapters: CatalogChapter[] }> {
  return orderedSections()
    .filter((s) => s.shape === 'chapter')
    .map((s) => ({ section: s.id, title: s.title, chapters: chaptersOf(s.id) }))
}

/**
 * 章节 id → 它的规范 URL。前后翻页、面包屑、跳转回落全部走这一个函数。
 *
 * **URL 里没有目标语言**：速查板块的目标由页内的对比语言选择条决定。
 * 目标进 URL 会让同一份内容散成十几个地址，而它其实只是"我现在想看哪个方向"。
 *
 * 基准进 URL：每个基准是一套独立的浏览语境，要能预渲染、能分享。
 */
export function chapterPathOf(baseline: string, section: Section, chapter: string): string {
  return `/compare/${baseline}/${section}/${chapter}`
}

/** 板块入口地址（不含目标语言） */
export function sectionPathOf(baseline: string, section: Section): string {
  return `/compare/${baseline}/${section}`
}

/**
 * 章节型板块的入口：该板块在该基准下第一个可用章节的地址。
 *
 * v2 的章节集合与基准无关（清单是语言无关的），所以这里只问「这个基准
 * 有没有这一章的分片」—— 由调用方（守卫 / 视图）判断，这里给清单首章。
 */
export function sectionFirstChapterPath(section: Section, baseline: string): string | null {
  const chapter = chaptersOf(section)[0]
  return chapter ? chapterPathOf(baseline, section, chapter.id) : null
}

/** 章内前后章（用于翻页）。章节顺序来自清单的数组顺序 */
export function siblingsOf(
  section: Section,
  chapter: string,
): { prev: CatalogChapter | null; next: CatalogChapter | null } {
  const list = chaptersOf(section)
  const i = list.findIndex((c) => c.id === chapter)
  if (i < 0) return { prev: null, next: null }
  return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null }
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

/** 便捷：某门语言在某章有没有分片（不加载，只查 glob 键） */
export function hasBoxChapter(lang: string, section: Section, chapter: string): boolean {
  return Boolean(boxShards[boxShardPathOf(lang, section, chapter)])
}

export type { Equivalence }
