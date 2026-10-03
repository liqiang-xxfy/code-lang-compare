<script setup lang="ts">
/**
 * 一排横向可滚的卡片：溢出时给两侧加渐隐遮罩，并在需要时补一句文字提示。
 *
 * 为什么要有这一层：卡片并排是**每列最小 340px**的栅格，五门语言在常见宽度下
 * 必然溢出。滚出去的那几列在视觉上完全不存在 —— 没有遮罩也没有文字的话，
 * 读者不会想到「右边还有」。渐变遮罩是安静的那一半（告诉你有东西被挡住），
 * 文字是说得出口的那一半（告诉你可以拖）。
 *
 * 文字提示由调用方用 `showHint` 控制在**只在一排上**出现：一页有六七个
 * feature 面板，每个面板各挂一句同样的话就成了噪声。
 *
 * 预渲染时量不到宽度，`overflowing` 恒为 false，于是静态 HTML 里既没有遮罩
 * 也没有提示 —— 这是对的：它们本来就是对**当前视口**才成立的说明，
 * 客户端挂载后（本应用不做 hydration，见 main.ts）立刻按实测渲染。
 */
import { ref } from 'vue'
import { useHorizontalOverflow } from '@/composables/useHorizontalOverflow'
import { useI18n } from '@/composables/useI18n'

const props = withDefaults(
  defineProps<{
    /** 可见列数 —— 只用于提示文案里的「共 N 门语言」 */
    count: number
    /** 是否在这一排渲染文字提示（同一页只该有一排渲染） */
    showHint?: boolean
  }>(),
  { showHint: false },
)

const { t } = useI18n()
const track = ref<HTMLElement | null>(null)
const { overflowing, atStart, atEnd } = useHorizontalOverflow(track)
</script>

<template>
  <div class="pc-scroll-row">
    <div class="pc-scroll-viewport">
      <div ref="track" class="pc-cards">
        <slot />
      </div>
      <!-- 已经拖到那一头时遮罩自己消失：留在那里就是在说谎 -->
      <span
        v-if="overflowing && !atStart"
        class="pc-scroll-fade is-left"
        aria-hidden="true"
      />
      <span v-if="overflowing && !atEnd" class="pc-scroll-fade is-right" aria-hidden="true" />
    </div>
    <p v-if="overflowing && props.showHint" class="pc-hint pc-scroll-hint">
      {{ t('compareBar.hScrollHint', { n: props.count }) }}
    </p>
  </div>
</template>
