<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import type { Equivalence } from '@/schemas'

const props = defineProps<{ value: Equivalence; compact?: boolean }>()
const { t } = useI18n()

/** 颜色 + 图标 + 文字 三重编码 —— 不以颜色作为唯一判据（ADR-14） */
const GLYPH: Record<Equivalence, string> = {
  identical: '=',
  analogous: '≈',
  divergent: '≠',
  absent: '∅',
}

const label = computed(() => t(`equivalence.${props.value}`))
const hint = computed(() => t(`equivalence.${props.value}Hint`))
</script>

<template>
  <span class="pc-eq" :data-eq="value" :title="hint">
    <span class="pc-eq-glyph" aria-hidden="true">{{ GLYPH[value] }}</span>
    <span v-if="!compact">{{ label }}</span>
    <span v-else class="pc-visually-hidden">{{ label }}</span>
  </span>
</template>
