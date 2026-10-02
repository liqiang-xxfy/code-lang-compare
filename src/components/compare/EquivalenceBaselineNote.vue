<script setup lang="ts">
/**
 * 等价性徽章的参照系说明。
 *
 * 为什么需要它：徽章（= ≈ ≠ ∅）是**人手写的绝对值**（「Python 没有 var 提升」这类
 * 事实机器判不了），所以必须说清楚它是以谁为参照系判的。
 *
 * P7 之前参照系是一个全局常量，说明的作用是「提醒你它不随基准变」；
 * 现在内容按 (基准, 目标) 对撰写（ADR-24），参照系就是**本页的基准**，
 * 说明的作用变成了「这一页的判断标准是什么」—— 仍然必须写，否则读者会
 * 以为徽章是相对于「另一侧的对比语言」的。
 *
 * **默认收起**：这段话在每一页都出现，而章节页正文之前已经堆了面包屑、标题、
 * 草稿提示、语言条、视图模式五层。收起的是「四个符号各是什么意思」这段，
 * 但**参照系是哪一门语言必须留在摘要行上** —— 那才是这一页的判断标准，
 * 藏起来就等于把说明本身也藏了。
 */
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { usePersistedState } from '@/composables/usePersistedState'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const languages = useLanguageStore()

const baselineName = computed(
  () => languages.metaOf(languages.effectiveBaseline)?.name ?? languages.effectiveBaseline,
)

/** 展开态是个人偏好，跨页记住 —— 读懂了就不必每页再展开一次 */
const open = usePersistedState<boolean>('ui:eqLegend', false)
</script>

<template>
  <details class="pc-ref-note" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
    <summary>{{ t('baseline.referenceNoteSummary', { name: baselineName }) }}</summary>
    <p class="pc-hint">{{ t('baseline.referenceNote', { name: baselineName }) }}</p>
  </details>
</template>

<style scoped>
.pc-ref-note {
  margin: 0 0 12px;
  font-size: var(--pc-fs-xs);
  color: var(--pc-text-mute);
}
.pc-ref-note summary {
  cursor: pointer;
  line-height: 1.6;
  /* 摘要行本身就是「这一页以谁为参照系」，不该看起来像可忽略的灰字 */
  color: var(--pc-text-soft);
}
.pc-ref-note summary:hover {
  color: var(--pc-accent);
}
.pc-ref-note p {
  margin: 6px 0 0;
  line-height: 1.6;
}
</style>
