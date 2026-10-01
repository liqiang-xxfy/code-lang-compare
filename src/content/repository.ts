/**
 * ContentRepository —— 运行时取数契约（架构定稿 §3.4 / §7.1）。
 *
 * 为什么要有这层抽象：预渲染（D-B）要求「任意路由能在 Node 里独立取数」，
 * 而客户端要按 topic 分片懒加载。两者共用同一组接口，视图层就完全不需要知道
 * 数据是从动态 import 来还是从 SSR 预加载里来（后续换 SSG / 换后端不动视图）。
 *
 * 首期实现：静态 JSON 分片（lazy dynamic import）。
 * 刻意**不用** eager glob —— 那会把全部内容打进主包，毁掉分片。
 */
import attrsJson from '../generated/attributions.json'
import i18nJson from '../generated/i18n.json'
import manifestJson from '../generated/manifest.json'
import staticJson from '../generated/static.json'
import type {
  AttributionEntry,
  ConceptGroup,
  GlossaryTerm,
  Manifest,
  RenderedChapter,
  RenderedPitfall,
  RoadmapStage,
} from '../schemas'

export interface StaticPayload {
  pitfalls: RenderedPitfall[]
  concepts: ConceptGroup[]
  glossary: GlossaryTerm[]
  roadmaps: Record<string, RoadmapStage[]>
}

export interface AttributionPayload {
  generatedAt: string
  siteLicense: string
  entries: AttributionEntry[]
}

export const manifest = manifestJson as unknown as Manifest
export const staticPayload = staticJson as unknown as StaticPayload
export const attributionPayload = attrsJson as unknown as AttributionPayload
export const i18nMessages = i18nJson as unknown as Record<string, unknown>

/**
 * 分片粒度 = 一章一个文件。键是 `<topicId>/<chapterSlug>` 形式的 chapterId，
 * 与路由参数、manifest、sitemap 完全同构（不会出现「三个地方各有一套命名」）。
 */
const chapterShards = import.meta.glob<RenderedChapter>('../generated/content/**/*.json', {
  import: 'default',
})

const chapterCache = new Map<string, RenderedChapter>()

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

export function getFeatureIndexEntry(featureId: string) {
  return manifest.featureIndex[featureId]
}

export function getPitfalls(): RenderedPitfall[] {
  return staticPayload.pitfalls
}

export function getConcepts(): ConceptGroup[] {
  return staticPayload.concepts
}

export function getGlossary(): GlossaryTerm[] {
  return staticPayload.glossary
}

export function getRoadmap(langId: string): RoadmapStage[] {
  return staticPayload.roadmaps[langId] ?? []
}

/**
 * 该语言是否已有路线图。
 * 导航与链接必须据此决定是否渲染 —— 否则会生成「点进去发现是空的」死链。
 * 判断依据取自 manifest.routes，与预渲染、sitemap 同源，不可能不一致。
 */
export function hasRoadmap(langId: string): boolean {
  return manifest.routes.includes(`/roadmap/${langId}`)
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
