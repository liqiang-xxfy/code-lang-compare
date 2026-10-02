/**
 * ContentRepository —— 运行时取数契约（架构定稿 §3.4 / §7.1）。
 *
 * 为什么要有这层抽象：预渲染（D-B）要求「任意路由能在 Node 里独立取数」，
 * 而客户端要按 chapter / 按 (基准,目标) 对分片懒加载。两者共用同一组接口，
 * 视图层就完全不需要知道数据是从动态 import 来还是从 SSR 预加载里来。
 *
 * 首期实现：静态 JSON 分片（lazy dynamic import）。
 * 刻意**不用** eager glob —— 那会把全部内容打进主包，毁掉分片。
 */
import attrsJson from '../generated/attributions.json'
import i18nJson from '../generated/i18n.json'
import manifestJson from '../generated/manifest.json'
import type {
  AttributionEntry,
  Manifest,
  PairPayload,
  RenderedChapter,
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
  baseline: string
  docCount: number
  byType: Record<string, number>
  index: string
}

export const manifest = manifestJson as unknown as Manifest
export const attributionPayload = attrsJson as unknown as AttributionPayload
export const i18nMessages = i18nJson as unknown as Record<string, unknown>

/* ────────────────── 板块（section）注册表 ────────────────── */

/**
 * 板块属性的**唯一读取口**。
 *
 * 这些判断此前散落成 `section === 'basics'` 字面量，并在四处被当作
 * 「是否基准级」的判据 —— 漏改不报错，页面只是静默按 migration 渲染。
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
 * feature id 形如 `<topicId>/<slug>`，斜杠不能直接进 `#` 片段，统一取 slug 段。
 * 两个布局（矩阵的行、并排的卡片）与页内目录共用这一个函数 ——
 * 各拼一套的话，目录里点得到、布局里锚不上，是那种「看着正常但不生效」的错。
 */
export const featureAnchor = (featureId: string): string =>
  `feature-${featureId.split('/').pop() ?? featureId}`

/**
 * 第一个章节型板块（按 order）。
 *
 * 用在「要保持在同一类页面里」的回落：切基准时保留章节语境（useBaselineSwitch）、
 * 语言页的「以它为基准浏览基础语法」入口。它的语义是**形态**（第一个有章节的），
 * 不是「站点落点」—— 落点见下面的 `landingSection`。
 */
export const firstChapterSection = (): Section | null =>
  orderedSections().find((s) => s.shape === 'chapter')?.id ?? null

/**
 * 站点落点板块 —— `registry.yaml` 里声明 `landing: true` 的那个。
 *
 * 为什么是数据而不是写死 `'roadmap'`：站点落点是**策展决策**（从「我要迁移」
 * 进来的用户最该先看到什么），换一个只该改 registry 一行；写死 id 还会迫使
 * `verify:sections` 的白名单多一条「这里为什么可以出现板块名」的注解。
 *
 * 没声明时回落到第一个章节型板块 —— 与 `landing` 字段出现之前的行为一致，
 * 因此这个字段是可选的增量，不是必需配置。
 */
export const landingSection = (): Section | null =>
  orderedSections().find((s) => s.landing)?.id ?? firstChapterSection()

/**
 * 分片粒度 = 一章一个文件。键是 `<topicId>/<chapterSlug>` 形式的 chapterId，
 * 与路由参数、manifest、sitemap 完全同构（不会出现「三个地方各有一套命名」）。
 */
const chapterShards = import.meta.glob<RenderedChapter>('../generated/content/**/*.json', {
  import: 'default',
})

/** 对级静态资源：`static/<baseline>--<target>.json`，键能从 (基准, 目标) 直接推出来 */
const pairShards = import.meta.glob<PairPayload>('../generated/static/*.json', { import: 'default' })

/** 搜索索引按基准分片，一次只下载当前基准那一份 */
const searchShards = import.meta.glob<SearchShard>('../generated/search-index/*.json', {
  import: 'default',
})

const chapterCache = new Map<string, RenderedChapter>()
const pairCache = new Map<string, PairPayload>()
const searchCache = new Map<string, SearchShard>()

export function shardKeyOf(chapterId: string): string {
  return `../generated/content/${chapterId}.json`
}

/** 取一章的内容分片。找不到返回 null（路由层负责转 404）。 */
export async function getChapter(chapterId: string): Promise<RenderedChapter | null> {
  const cached = chapterCache.get(chapterId)
  if (cached) return cached
  const loader = chapterShards[shardKeyOf(chapterId)]
  if (!loader) return null
  const payload = await loader()
  chapterCache.set(chapterId, payload)
  return payload
}

/* ────────────────── (基准, 目标) 对 ────────────────── */

export const pairKey = (baseline: string, target: string): string => `${baseline}|${target}`

export function pairShardKey(baseline: string, target: string): string {
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
  const loader = pairShards[pairShardKey(baseline, target)]
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

export async function getSearchShard(baseline: string): Promise<SearchShard | null> {
  const cached = searchCache.get(baseline)
  if (cached) return cached
  const loader = searchShards[`../generated/search-index/${baseline}.json`]
  if (!loader) return null
  const payload = await loader()
  searchCache.set(baseline, payload)
  return payload
}

/* ────────────────── 语言与语言入口 ────────────────── */

export function getFeatureIndexEntry(featureId: string) {
  return manifest.featureIndex[featureId]
}

export function getAttributions(): AttributionPayload {
  return attributionPayload
}

/** 从 manifest 找出某个 Feature 所属的 chapter，用于「在上下文中打开」 */
export function findChapterOfFeature(featureId: string): string | null {
  return manifest.featureIndex[featureId]?.chapterId ?? null
}

/** 侧边导航所需的最小树（来自 manifest，不进内容分片） */
export function getNavigation() {
  return manifest.topics
}

/**
 * 从 (基准, 板块, 目标) 反查 topic id。
 *
 * 路由参数里没有 topicId —— 它在新的 URL 形状里是**派生量**。
 * 集中成一个函数是为了避免各处靠字符串拼接猜（`js2python` 拼不出来）。
 */
/** 某板块在某基准（对级还要 target）下对应的 topic —— 路由里没有 topicId，它是派生量 */
export function topicOf(section: Section, baseline: string, target?: string) {
  return (
    manifest.topics.find(
      (t) =>
        t.section === section &&
        t.baseline === baseline &&
        // 「要不要匹配 target」由板块的 scope 决定，不再由 `section === 'basics'` 决定
        (!sectionUsesTarget(section) || t.target === target),
    ) ?? null
  )
}

export function topicIdOf(baseline: string, section: Section, target?: string): string | null {
  return topicOf(section, baseline, target)?.id ?? null
}

/**
 * 章节 id → 它的规范 URL。前后翻页、面包屑、跳转回落全部走这一个函数。
 *
 * **URL 里没有目标语言**：对级板块的目标由页内的对比语言选择条决定（见 §15.11）。
 * 目标进 URL 会让同一份内容散成 12 个地址，而它其实只是"我现在想看哪个方向"。
 */
export function chapterPathOf(chapterId: string): string {
  const [topicId, slug] = chapterId.split('/')
  const cfg = manifest.topics.find((t) => t.id === topicId)
  if (!cfg || !slug) return '/404'
  // 曾有一个 `section === 'basics'` 的三元，但两个分支的地址逐字相同 —— 纯冗余，已删
  return `/compare/${cfg.baseline}/${cfg.section}/${slug}`
}

/** 板块入口地址（不含目标语言） */
export function sectionPathOf(baseline: string, section: Section): string {
  return `/compare/${baseline}/${section}`
}

/**
 * 某板块在某上下文下的章节（已按 order）。
 *
 * 取代了 `basicsChaptersOf` —— 那个名字把板块写死进了函数名，
 * 于是「高级语法对比」这类新章节型板块没有函数可用。
 */
export function chaptersOf(section: Section, baseline: string, target?: string) {
  return topicOf(section, baseline, target)?.chapters ?? []
}

/**
 * 章节型板块的入口：该板块在该基准下第一个可用章节的地址。
 *
 * 对级板块（scope: pair）刻意**不按 target 匹配**，取「第一个真正有章节的方向」——
 * 与调用方的处境一致：路由的 redirect 函数够不到 store，拿不到用户选的方向。
 * 这与 `resolvePairTarget` 的兜底分支同口径（都取 available[0]）。
 */
export function chaptersForSection(section: Section, baseline: string) {
  const topic = sectionUsesTarget(section)
    ? manifest.topics.find(
        (t) => t.section === section && t.baseline === baseline && t.chapters.length > 0,
      )
    : topicOf(section, baseline)
  return topic?.chapters ?? []
}

export function sectionFirstChapterPath(section: Section, baseline: string): string | null {
  const chapter = chaptersForSection(section, baseline)[0]
  return chapter ? chapterPathOf(chapter.id) : null
}

/**
 * 对级板块的**有效目标语言**。
 *
 * 目标不进 URL，所以每次渲染都要算一次"现在该看哪个方向"。规则按优先级：
 *   1. 用户**最近一次挑的**目标（刚在页内选择条里选了 Go，页面就该跟着换）
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

/*
 * 这里曾有 `firstMigrationPath` —— 被 sectionFirstChapterPath 取代。
 * 它的教训留在这里：地址里**没有目标语言**（`/compare/<基准>/<板块>/<章节 slug>`，
 * 正好 4 段），多拼一段 target 会涨到 5 段而匹配不上任何路由 ——
 * 左栏「迁移教程」入口曾因此一直点不进内容（redirects.test.ts 有断言钉住段数）。
 */
