import { defineStore } from 'pinia'
import { ref, shallowRef, type Ref } from 'vue'
import {
  boxShardKeyOf,
  getBoxGroup,
  getPairPayload,
  hasBoxGroup,
  pairKey,
} from '@/content/repository'
import type { PairPayload, RenderedBox, RenderedBoxChapter, Section } from '@/schemas'

/**
 * 内容装载。只保存「已加载的分片」，路由变化时按需加载。
 *
 * 为什么用 ensure* 而不是组件内 await：
 *  · 路由守卫里 await 完成后，视图组件可以同步渲染 —— SSR（预渲染）与 CSR 走同一条路，
 *    不需要 <Suspense>，也就没有两条渲染路径。
 *
 * 分片粒度是**一门语言 × 一个存放组**。但一个章节页展示的是**某基准的某一章**，
 * 而章引用的是若干存放组的组合 —— 所以视图拿到的是「合并后的一门语言的格子表」，
 * 而不是原始分片。合并的规则必须与构建期的路由判据同口径。
 */
export const useContentStore = defineStore('content', () => {
  /** 原始分片，键 `<语言>/<板块>/<存放组>` */
  const boxGroups = shallowRef<Record<string, RenderedBoxChapter>>({})
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
   * `pending` / `pairPending` 只做并发去重，不是响应式的，视图看不到它们的变化，
   * 所以另记一份。少了这一份，页内换对比语言（不产生导航）时会先闪一帧空态，
   * 用户读到的是「这门语言没有内容」而不是「马上就来」。
   */
  const groupLoading = ref<Record<string, boolean>>({})
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

  /** 确保「一门语言 × 一个存放组」的分片已加载 */
  async function ensureGroup(
    lang: string,
    section: Section,
    group: string,
  ): Promise<RenderedBoxChapter | null> {
    const key = boxShardKeyOf(lang, section, group)
    const loaded = boxGroups.value[key]
    if (loaded) return loaded
    const inflight = pending.get(key)
    if (inflight) return inflight
    // 清掉上一页残留的错误 —— 否则新页面会顶着一个与它无关的失败提示
    error.value = null
    setLoading(groupLoading, key, true)
    const task = getBoxGroup(lang, section, group)
      .then((payload) => {
        if (payload) boxGroups.value = { ...boxGroups.value, [key]: payload }
        return payload
      })
      .catch(noteError)
    pending.set(key, task)
    try {
      return await task
    } finally {
      pending.delete(key)
      setLoading(groupLoading, key, false)
    }
  }

  /**
   * 按「可见语言 × 本章引用的存放组」批量确保。
   *
   * 为什么一次要等这么多：**换对比语言不产生导航**，守卫不会重跑；而预渲染（SSG）
   * 在守卫 resolve 之后**同步**渲染 —— 少等一份分片，预渲染出来的那一页就会
   * 停在「加载中」，即「页面结构在、内容不在」的空壳。
   */
  async function ensureChapter(
    section: Section,
    groups: readonly string[],
    langs: readonly string[],
  ): Promise<void> {
    const tasks: Array<Promise<unknown>> = []
    for (const lang of langs) {
      for (const g of groups) {
        // 该语言压根没写这个存放组时不必去加载（glob 里没有它的键）
        if (!hasBoxGroup(lang, section, g)) continue
        tasks.push(ensureGroup(lang, section, g))
      }
    }
    await Promise.all(tasks)
  }

  /** 已加载则同步取某个存放组的分片 */
  function getGroupRaw(lang: string, section: Section, group: string): RenderedBoxChapter | null {
    return boxGroups.value[boxShardKeyOf(lang, section, group)] ?? null
  }

  /**
   * 合并一门语言在若干存放组里的格子。
   *
   * 返回 `null` = **还有分片没加载完**（视图显示加载态）；返回 `{}` = 这门语言
   * 在这一章里确实没有内容（视图显示空态）。两者必须可区分 —— 否则用户读到的是
   * 「这门语言没有内容」而不是「马上就来」。
   */
  function boxesOf(
    lang: string,
    section: Section,
    groups: readonly string[],
  ): Record<string, RenderedBox> | null {
    const out: Record<string, RenderedBox> = {}
    for (const g of groups) {
      const shard = getGroupRaw(lang, section, g)
      if (!shard) {
        // 构建产物里就没有这份分片 = 这门语言没写这个存放组，跳过；否则是还没加载完
        if (hasBoxGroup(lang, section, g)) return null
        continue
      }
      Object.assign(out, shard.boxes)
    }
    return out
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

  /** 某个存放组是否正在装载 —— 视图据此区分「加载中」与「装载失败」 */
  function isGroupLoading(lang: string, section: Section, group: string): boolean {
    return Boolean(groupLoading.value[boxShardKeyOf(lang, section, group)])
  }

  /** 已加载则同步取 —— 视图在 ensurePair 完成后用它渲染 */
  function getPairRaw(baseline: string, target: string): PairPayload | null {
    return pairs.value[pairKey(baseline, target)] ?? null
  }

  return {
    boxGroups,
    pairs,
    error,
    ensureGroup,
    ensureChapter,
    ensurePair,
    getGroupRaw,
    boxesOf,
    getPairRaw,
    isPairLoading,
    isGroupLoading,
  }
})
