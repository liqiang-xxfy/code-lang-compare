/**
 * 横向溢出状态 —— 「这一排还能往右拖」。
 *
 * 为什么需要它：多列并排时容器横向可滚（`overflow-x: auto`），而滚动条太安静 ——
 * 读者看到两列就以为只有两列，右边还有几门语言这件事没有任何提示。
 *
 * 为什么不用纯 CSS：做不到「有溢出才显示」。`scroll-state()` 尚未落地，
 * `:has()` 问不出溢出（它判的是选择器匹配，不是布局），而给容器加
 * `background-attachment: local` 的滚动阴影技巧要求底色不透明、
 * 且会在圆角与留白处露馅。量一次 scrollWidth 是最直接也最诚实的做法。
 *
 * `atStart` / `atEnd` 是给提示**自己消失**用的：一条永远挂着的
 * 「可左右拖动」，在已经拖到头的时候就是假话。
 *
 * 判据带 1px 容差：缩放、小数宽度下 `scrollWidth` 常比 `clientWidth` 大一丁点，
 * 不设容差就会在一排根本没溢出的卡片上亮起提示。
 */
import { onMounted, ref, watch, type Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'

export interface HorizontalOverflow {
  /** 内容比容器宽 —— 有东西被挡住了 */
  overflowing: Ref<boolean>
  atStart: Ref<boolean>
  atEnd: Ref<boolean>
}

const TOLERANCE = 1

export function useHorizontalOverflow(target: Ref<HTMLElement | null>): HorizontalOverflow {
  const overflowing = ref(false)
  const atStart = ref(true)
  const atEnd = ref(true)

  function update(): void {
    const el = target.value
    if (!el) return
    overflowing.value = el.scrollWidth - el.clientWidth > TOLERANCE
    atStart.value = el.scrollLeft <= TOLERANCE
    atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - TOLERANCE
  }

  /* 两个监听器都跟着 ref 走：元素被 v-for 换掉时自动改绑，不需要手动解绑 */
  useEventListener(target, 'scroll', update, { passive: true })
  useResizeObserver(target, update)
  /* 换元素（列数变化会重建卡片）时重量一次；post 保证量到的是新布局 */
  watch(target, update, { flush: 'post' })
  onMounted(update)

  return { overflowing, atStart, atEnd }
}
