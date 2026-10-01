<script setup lang="ts">
import { useI18n } from '@/composables/useI18n'
import type { ViewMode } from '@/stores/ui'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

const modes: Array<{ value: ViewMode; label: string }> = [
  { value: 'matrix', label: t('viewMode.matrix') },
  { value: 'side-by-side', label: t('viewMode.sideBySide') },
  { value: 'baseline-diff', label: t('viewMode.baselineDiff') },
]
</script>

<template>
  <div class="pc-toolbar">
    <div class="pc-seg" role="group" :aria-label="t('viewMode.label')">
      <button
        v-for="mode in modes"
        :key="mode.value"
        type="button"
        :aria-pressed="ui.viewMode === mode.value"
        @click="ui.viewMode = mode.value"
      >
        {{ mode.label }}
      </button>
    </div>

    <label class="pc-hint" style="display: inline-flex; gap: 5px; align-items: center">
      <input v-model="ui.onlyDifferent" type="checkbox" />
      {{ t('filter.onlyDifferent') }}
    </label>
  </div>
</template>
