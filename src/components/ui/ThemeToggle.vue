<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

const label = computed(() => {
  const map = { system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') }
  return `${t('theme.label')}：${map[ui.themePreference]}`
})

const glyph = computed(() => ({ system: '◐', light: '☀', dark: '☾' })[ui.themePreference])
</script>

<template>
  <button class="pc-btn" type="button" :title="label" :aria-label="label" @click="ui.cycleTheme()">
    <span aria-hidden="true">{{ glyph }}</span>
    <span class="pc-visually-hidden">{{ label }}</span>
  </button>
</template>
