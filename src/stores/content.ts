import { defineStore } from 'pinia'
import { ref, shallowRef, type Ref } from 'vue'
import { getChapter, getPairPayload, manifest, pairKey } from '@/content/repository'
import type { PairPayload, RenderedChapter, RenderedFeature } from '@/schemas'

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
  /**
   * 最近一次装载失败的原因；下一次装载成功即清空。
   *
   * 这里的取舍是**吞掉异常并返回 null**，而不是 rethrow：守卫把 null 当 404/回落
   * （guards.ts:65 / :111），reject 会让导航直接 abort —— 页面整个黑掉，比一次
   * 分片加载失败严重得多。代价是「深链时错误被 404 掩盖」，所以视图侧要能读到它。
   */
  const error = ref<string | null>(null)

  /**
   * 装载中标记 —— **必须是响应式的**，视图要靠它区分「正在加载」与「确实没有内容」。
   *
   * `pending` / `pairPending` 两个 Map 只做并发去重，不是响应式的，视图看不到它们的变化，
   * 所以另记一份。少了这一份，页内换目标语言（不产生导航）时会先闪一帧空态，
   * 用户读到的是「这个方向没有内容」而不是「马上就来」。
   */
  const chapterLoading = ref<Record<string, boolean>>({})
  const pairLoading = ref<Record<string, boolean>>({})

  function setLoading(target: Ref<Record<string, boolean>>, key: string, on: boolean): void {
    const next = { ...target.value }
    if (on) next[key] = true
    else delete next[key]
    target.value = next
  }

  function noteError(err: unknown): null {
    error.value = err instanceof Error ? err.message : String(err)
    return null
  }

  /**
   * 已加载的对级分片（陷阱 / 词典 / 路线）。
   *
   * 为什么要在这里再存一份**响应式**的：repository 的缓存是普通 Map，
   * 而目标语言现在由页内的对比语言选择条决定 —— 用户在页面上换一门语言时路由不变，
   * 没有新的导航去触发守卫。视图必须能感知到"这份分片刚加载完"。
   */
  const pairs = shallowRef<Record<string, PairPayload>>({})
  /** 对级分片的并发去重表 —— 与上面的 `pending` 同构（此前漏了，重复请求会各下载一次） */
  const pairPending = new Map<string, Promise<PairPayload | null>>()

  async function ensureChapter(chapterId: string): Promise<RenderedChapter | null> {
    const loaded = chapters.value[chapterId]
    if (loaded) return loaded
    const inflight = pending.get(chapterId)
    if (inflight) return inflight
    // 清掉上一页残留的错误 —— 否则新页面会顶着一个与它无关的失败提示
    error.value = null
    setLoading(chapterLoading, chapterId, true)
    const task = getChapter(chapterId)
      .then((payload) => {
        if (payload) chapters.value = { ...chapters.value, [chapterId]: payload }
        return payload
      })
      .catch(noteError)
    pending.set(chapterId, task)
    try {
      return await task
    } finally {
      pending.delete(chapterId)
      setLoading(chapterLoading, chapterId, false)
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

  /** 确保某个 (基准, 目标) 对的分片已加载 */
  async function ensurePair(baseline: string, target: string): Promise<PairPayload | null> {
    const key = pairKey(baseline, target)
    const loaded = pairs.value[key]
    if (loaded) return loaded
    const inflight = pairPending.get(key)
    if (inflight) return inflight
    error.value = null
    setLoading(pairLoading, key, true)
    const task = getPairPayload(baseline, target)
      .then((payload) => {
        if (payload) pairs.value = { ...pairs.value, [key]: payload }
        return payload
      })
      .catch(noteError)
    pairPending.set(key, task)
    try {
      return await task
    } finally {
      pairPending.delete(key)
      setLoading(pairLoading, key, false)
    }
  }

  /** 该 (基准, 目标) 对是否正在装载 —— 视图据此显示加载态而不是空态 */
  function isPairLoading(baseline: string, target: string): boolean {
    return Boolean(pairLoading.value[pairKey(baseline, target)])
  }

  /** 章节分片是否正在装载 —— ChapterCompareView 据此区分「加载中」与「装载失败」 */
  function isChapterLoading(chapterId: string): boolean {
    return Boolean(chapterLoading.value[chapterId])
  }

  /** 已加载则同步取 —— 视图在 ensurePair 完成后用它渲染 */
  function getPairRaw(baseline: string, target: string): PairPayload | null {
    return pairs.value[pairKey(baseline, target)] ?? null
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
    pairs,
    error,
    ensureChapter,
    ensureFeature,
    ensurePair,
    getChapterRaw,
    getFeatureRaw,
    getPairRaw,
    isPairLoading,
    isChapterLoading,
    siblingsOf,
    isValidChapter,
  }
})
