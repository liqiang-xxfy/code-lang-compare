<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import type { Equivalence } from '@/schemas'

const props = defineProps<{
  value: Equivalence
  compact?: boolean
  /**
   * 语言短名（JS / Py / Go…）。
   *
   * 只有在**一次排出一串徽章**时才需要传 —— 单个徽章长在它所属语言的那一列里，
   * 位置本身就是语言标识；一串排开就不同了：没有名字时，「语义不同」连着出现
   * 三次看起来就是同一个标签刷了三遍，读者根本不知道哪个对应哪门语言。
   */
  langName?: string
}>()
const { t } = useI18n()

/** 颜色 + 图标 + 文字 三重编码 —— 不以颜色作为唯一判据（ADR-14） */
const GLYPH: Record<Equivalence, string> = {
  identical: '=',
  analogous: '≈',
  divergent: '≠',
  absent: '∅',
}

const label = computed(() => t(`equivalence.${props.value}`))
const hint = computed(() => {
  const base = t(`equivalence.${props.value}Hint`)
  return props.langName ? `${props.langName}：${base}` : base
})
</script>

<template>
  <span class="pc-eq" :data-eq="value" :title="hint">
    <span v-if="langName" class="pc-eq-lang">{{ langName }}</span>
    <span class="pc-eq-glyph" aria-hidden="true">{{ GLYPH[value] }}</span>
    <span v-if="!compact">{{ label }}</span>
    <span v-else class="pc-visually-hidden">{{ label }}</span>
  </span>
</template>
