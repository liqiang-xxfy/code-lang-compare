<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import { getCachedDiff, type LineDiff } from '@/content/diff'
import type { RenderedChapter, RenderedFeature } from '@/schemas'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ chapter: RenderedChapter; diffMode?: boolean }>()

const ui = useUiStore()
const languages = useLanguageStore()
const { t } = useI18n()

const columns = computed(() => languages.orderedMeta)

const rows = computed(() =>
  props.chapter.features.filter((feature) => {
    if (!ui.onlyDifferent) return true
    return Object.values(feature.snippets).some((s) => s.equivalence !== 'identical')
  }),
)

/** 基准列永远不画 diff（它是参照系本身）；diff 在运行时算，按 (feature,baseline,target) 缓存 */
function diffFor(feature: RenderedFeature, langId: string): LineDiff | null {
  if (!props.diffMode || langId === languages.baseline) return null
  const base = feature.snippets[languages.baseline]
  const target = feature.snippets[langId]
  if (!base?.code || !target?.code) return null
  return getCachedDiff(`${feature.id}|${languages.baseline}|${langId}`, base.code, target.code)
}
</script>

<template>
  <div class="pc-tablewrap">
    <table class="pc-matrix">
      <caption class="pc-visually-hidden">
        {{ chapter.title }}：每个特性在各语言中的写法对照
      </caption>
      <thead>
        <tr>
          <th class="pc-col-feature" scope="col">{{ chapter.title }}</th>
          <th
            v-for="lang in columns"
            :key="lang.id"
            scope="col"
            :class="{ 'is-baseline-col': lang.id === languages.baseline }"
          >
            {{ lang.name }}
            <span v-if="lang.id === languages.baseline" class="pc-hint">（基准）</span>
            <span v-if="lang.version" class="pc-hint">{{ lang.version }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="feature in rows" :key="feature.id">
          <th class="pc-col-feature" scope="row">
            <div class="pc-feature-cell">
              <RouterLink class="pc-feature-title" :to="`/feature/${feature.id}`">
                {{ feature.title }}
              </RouterLink>
              <div class="pc-feature-meta">
                <span class="pc-tag">{{ feature.kind }}</span>
                <EquivalenceBadge
                  v-for="s in Object.values(feature.snippets)"
                  :key="s.lang"
                  :value="s.equivalence"
                  :compact="true"
                />
              </div>
              <p v-if="feature.summary" class="pc-hint" style="margin: 0">
                {{ feature.summary }}
              </p>
            </div>
          </th>

          <td
            v-for="lang in columns"
            :key="`${feature.id}-${lang.id}`"
            :class="{ 'is-baseline-col': lang.id === languages.baseline }"
          >
            <div v-if="feature.snippets[lang.id]" class="pc-cell-inner">
              <CodeBlock
                :snippet="feature.snippets[lang.id]!"
                :lang-meta="lang"
                :diff="diffFor(feature, lang.id)"
              />
            </div>
            <div v-else class="pc-cell-empty">{{ t('emptyCell') }}</div>
          </td>
        </tr>

        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1">
            <div class="pc-empty">{{ t('allSame') }}</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
