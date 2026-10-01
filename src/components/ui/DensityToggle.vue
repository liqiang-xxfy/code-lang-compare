<script setup lang="ts">
import { useI18n } from '@/composables/useI18n'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()
</script>

<template>
  <div class="pc-seg" role="group" :aria-label="t('density.label')">
    <button
      type="button"
      :aria-pressed="ui.density === 'compact'"
      :title="t('density.compact')"
      @click="ui.density = 'compact'"
    >
      {{ t('density.compact') }}
    </button>
    <button
      type="button"
      :aria-pressed="ui.density === 'comfortable'"
      :title="t('density.comfortable')"
      @click="ui.density = 'comfortable'"
    >
      {{ t('density.comfortable') }}
    </button>
  </div>
</template>
