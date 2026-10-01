import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { getChapter, manifest } from '@/content/repository'
import type { RenderedChapter, RenderedFeature } from '@/schemas'

/**
 * 内容装载。只保存「已加载的章节分片」，路由变化时按需加载。
 *
 * 为什么用 ensureChapter 而不是组件内 await：
 *  · 路由守卫里 await 完成后，视图组件可以同步渲染 —— SSR（预渲染）与 CSR 走同一条路，
 *    不需要 <Suspense>，也就没有两条渲染路径（§7.1）。
 */
export const useContentStore = defineStore('content', () => {
  const chapters = shallowRef<Record<string, RenderedChapter>>({})
  const pending = new Map<string, Promise<RenderedChapter | null>>()
  const error = ref<string | null>(null)

  async function ensureChapter(chapterId: string): Promise<RenderedChapter | null> {
    const loaded = chapters.value[chapterId]
    if (loaded) return loaded
    const inflight = pending.get(chapterId)
    if (inflight) return inflight
    const task = getChapter(chapterId).then((payload) => {
      if (payload) chapters.value = { ...chapters.value, [chapterId]: payload }
      return payload
    })
    pending.set(chapterId, task)
    try {
      return await task
    } finally {
      pending.delete(chapterId)
    }
  }

  function getChapterRaw(chapterId: string): RenderedChapter | null {
    return chapters.value[chapterId] ?? null
  }

  function getFeatureRaw(featureId: string): RenderedFeature | null {
    for (const chapter of Object.values(chapters.value)) {
      const hit = chapter.features.find((f) => f.id === featureId)
      if (hit) return hit
    }
    return null
  }

  /** 从 manifest 反查 feature 所属章节，然后按需加载那一章的分片 */
  async function ensureFeature(featureId: string): Promise<RenderedFeature | null> {
    const info = manifest.featureIndex[featureId]
    if (!info) return null
    await ensureChapter(info.chapterId)
    return getFeatureRaw(featureId)
  }

  function isValidChapter(chapterId: string): boolean {
    return manifest.topics.some((t) => t.chapters.some((c) => c.id === chapterId))
  }

  /** 章节的前后导航（同一 topic 内），数据来自 manifest，不需要加载别的分片 */
  function siblingsOf(chapterId: string) {
    for (const topic of manifest.topics) {
      const index = topic.chapters.findIndex((c) => c.id === chapterId)
      if (index === -1) continue
      return {
        topicTitle: topic.title,
        prev: index > 0 ? topic.chapters[index - 1] : undefined,
        next: index < topic.chapters.length - 1 ? topic.chapters[index + 1] : undefined,
      }
    }
    return { topicTitle: '', prev: undefined, next: undefined }
  }

  return {
    chapters,
    error,
    ensureChapter,
    ensureFeature,
    getChapterRaw,
    getFeatureRaw,
    siblingsOf,
    isValidChapter,
  }
})
