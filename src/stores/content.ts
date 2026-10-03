import { defineStore } from 'pinia'
import { ref, shallowRef, type Ref } from 'vue'
import {
  boxShardKeyOf,
  getBoxChapter,
  getPairPayload,
  chapterOf,
  pairKey,
} from '@/content/repository'
import type { PairPayload, RenderedBoxChapter, Section } from '@/schemas'

/**
 * 内容装载。只保存「已加载的分片」，路由变化时按需加载。
 *
 * 为什么用 ensure* 而不是组件内 await：
 *  · 路由守卫里 await 完成后，视图组件可以同步渲染 —— SSR（预渲染）与 CSR 走同一条路，
 *    不需要 <Suspense>，也就没有两条渲染路径（§7.1）。
 *
 * v2 的分片粒度是**一门语言 × 一个章节**：一个章节页渲染 N 列，就按可见语言
 * 各加载一份（见 `ensureColumns`）。
 */
export const useContentStore = defineStore('content', () => {
  const boxChapters = shallowRef<Record<string, RenderedBoxChapter>>({})
  const pending = new Map<string, Promise<RenderedBoxChapter | null>>()
  /**
   * 最近一次装载失败的原因；下一次装载成功即清空。
   *
   * 这里的取舍是**吞掉异常并返回 null**，而不是 rethrow：守卫把 null 当 404/回落，
   * reject 会让导航直接 abort —— 页面整个黑掉，比一次分片加载失败严重得多。
   * 代价是「深链时错误被 404 掩盖」，所以视图侧要能读到它。
   */
  const error = ref<string | null>(null)

  /**
   * 装载中标记 —— **必须是响应式的**，视图要靠它区分「正在加载」与「确实没有内容」。
   *
   * `pending` / `pairPending` 两个 Map 只做并发去重，不是响应式的，视图看不到它们的变化，
   * 所以另记一份。少了这一份，页内换对比语言（不产生导航）时会先闪一帧空态，
   * 用户读到的是「这门语言没有内容」而不是「马上就来」。
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
   * 而目标语言由页内的对比语言选择条决定 —— 用户在页面上换一门语言时路由不变，
   * 没有新的导航去触发守卫。视图必须能感知到"这份分片刚加载完"。
   */
  const pairs = shallowRef<Record<string, PairPayload>>({})
  /** 对级分片的并发去重表 —— 与上面的 `pending` 同构 */
  const pairPending = new Map<string, Promise<PairPayload | null>>()

  /** 确保「一门语言在某章」的分片已加载 */
  async function ensureChapterShard(
    lang: string,
    section: Section,
    chapter: string,
  ): Promise<RenderedBoxChapter | null> {
    const key = boxShardKeyOf(lang, section, chapter)
    const loaded = boxChapters.value[key]
    if (loaded) return loaded
    const inflight = pending.get(key)
    if (inflight) return inflight
    // 清掉上一页残留的错误 —— 否则新页面会顶着一个与它无关的失败提示
    error.value = null
    setLoading(chapterLoading, key, true)
    const task = getBoxChapter(lang, section, chapter)
      .then((payload) => {
        if (payload) boxChapters.value = { ...boxChapters.value, [key]: payload }
        return payload
      })
      .catch(noteError)
    pending.set(key, task)
    try {
      return await task
    } finally {
      pending.delete(key)
      setLoading(chapterLoading, key, false)
    }
  }

  /**
   * 按可见语言批量确保 —— 一个章节页要渲染 N 列，就加载 N 份分片。
   * 并发去重交给 `ensureChapterShard`，这里只负责一起等。
   */
  async function ensureColumns(
    section: Section,
    chapter: string,
    langs: readonly string[],
  ): Promise<void> {
    await Promise.all(langs.map((lang) => ensureChapterShard(lang, section, chapter)))
  }

  /** 已加载则同步取 */
  function getBoxChapterRaw(
    lang: string,
    section: Section,
    chapter: string,
  ): RenderedBoxChapter | null {
    return boxChapters.value[boxShardKeyOf(lang, section, chapter)] ?? null
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

  /** 分片是否正在装载 —— 视图据此区分「加载中」与「装载失败」 */
  function isChapterLoading(lang: string, section: Section, chapter: string): boolean {
    return Boolean(chapterLoading.value[boxShardKeyOf(lang, section, chapter)])
  }

  /** 已加载则同步取 —— 视图在 ensurePair 完成后用它渲染 */
  function getPairRaw(baseline: string, target: string): PairPayload | null {
    return pairs.value[pairKey(baseline, target)] ?? null
  }

  /** 章节是否存在于清单（判据是清单，不是「有没有分片」） */
  function isValidChapter(section: Section, chapter: string): boolean {
    return chapterOf(section, chapter) !== null
  }

  return {
    boxChapters,
    pairs,
    error,
    ensureChapterShard,
    ensureColumns,
    ensurePair,
    getBoxChapterRaw,
    getPairRaw,
    isPairLoading,
    isChapterLoading,
    isValidChapter,
  }
})
