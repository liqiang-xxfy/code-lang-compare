/**
 * 对级内容的取数：分片在**目标语言变化时**按需加载。
 *
 * 为什么不能只靠路由守卫：目标语言不在 URL 里，用户在页内的对比语言选择条里
 * 换一门语言时**不发生导航**，守卫不会重跑。只靠守卫的话，换了语言页面会
 * 静默变成空白（分片没加载），而这正是最容易漏掉的一种"看起来像坏了"。
 *
 * 守卫仍然要加载（SSG 预渲染时没有 watcher 可用），这里只是把它接到响应式上。
 *
 * **为什么要连 `loading` 一起返回**：`payload` 在「正在下载」与「这个方向确实没写内容」
 * 两种情况下都是 null，只凭它渲染空态会在换方向时闪一帧「暂无内容」——
 * 用户读到的结论是错的。装载中标记由 store 提供（见 `content.ts` 的 `pairLoading`）。
 */
import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { useContentStore } from '@/stores/content'
import type { PairPayload } from '@/schemas'

export interface PairPayloadState {
  payload: ComputedRef<PairPayload | null>
  /** 分片正在装载。为真时视图应显示加载态，而不是空态 */
  loading: ComputedRef<boolean>
}

export function usePairPayload(baseline: Ref<string>, target: Ref<string>): PairPayloadState {
  const content = useContentStore()

  watch(
    [baseline, target],
    ([b, t]) => {
      if (b && t) void content.ensurePair(b, t)
    },
    { immediate: true },
  )

  const payload = computed(() => {
    if (!baseline.value || !target.value) return null
    return content.getPairRaw(baseline.value, target.value)
  })

  const loading = computed(() =>
    Boolean(baseline.value && target.value && content.isPairLoading(baseline.value, target.value)),
  )

  return { payload, loading }
}
