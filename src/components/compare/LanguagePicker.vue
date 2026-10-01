<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { enabledLanguageMeta, languageMeta } from '@/generated/registry.gen'
import { SOFT_COLUMN_LIMIT, useLanguageStore } from '@/stores/language'

const languages = useLanguageStore()
const { t } = useI18n()

/**
 * 只列「已启用」的语言作为可切换项。
 * 其余语言按 D-D 保留独立身份（例如 ArkTS 不并入 TypeScript），在此以只读标签展示规划状态，
 * 而不是给出点了没反应的复选框。
 */
const planned = computed(() => languageMeta.filter((m) => !enabledLanguageMeta.includes(m)))
</script>

<template>
  <div class="pc-picker">
    <span class="pc-hint">{{ t('baseline.label') }}：</span>
    <label v-for="lang in languages.activeMeta" :key="`b-${lang.id}`" class="pc-picker-item">
      <input
        type="radio"
        name="pc-baseline"
        :value="lang.id"
        :checked="languages.baseline === lang.id"
        @change="languages.setBaseline(lang.id)"
      />
      <span>{{ lang.shortName }}</span>
    </label>

    <span class="pc-hint" style="margin-left: 10px">{{ t('nav.languages') }}：</span>
    <label v-for="lang in enabledLanguageMeta" :key="`l-${lang.id}`" class="pc-picker-item">
      <input
        type="checkbox"
        :checked="languages.activeLangs.includes(lang.id)"
        @change="languages.toggleLanguage(lang.id)"
      />
      <span :title="lang.name">{{ lang.shortName }}</span>
    </label>

    <span
      v-if="planned.length"
      class="pc-hint"
      :title="`已规划、尚未启用：${planned.map((p) => p.name).join('、')}`"
    >
      · 待接入：{{ planned.map((p) => p.shortName).join('/') }}
    </span>

    <span v-if="languages.overSoftLimit" class="pc-hint" style="color: var(--pc-eq-analogous)">
      ⚠ 超过 {{ SOFT_COLUMN_LIMIT }} 列，建议切到「基准差异」模式
    </span>
  </div>
</template>

<style scoped>
.pc-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pc-picker-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--pc-fs-xs);
  color: var(--pc-text-soft);
  cursor: pointer;
}
</style>
