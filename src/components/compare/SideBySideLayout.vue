<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import type { RenderedChapter } from '@/schemas'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ chapter: RenderedChapter }>()

const ui = useUiStore()
const languages = useLanguageStore()
const { t } = useI18n()

const columns = computed(() => languages.orderedMeta)

const features = computed(() =>
  props.chapter.features.filter((feature) => {
    if (!ui.onlyDifferent) return true
    return Object.values(feature.snippets).some((s) => s.equivalence !== 'identical')
  }),
)

/** 同 MatrixLayout：区分「本方向不涉及」与「尚未提供实现」两种空 */
const coveredLangs = computed(() => {
  const ids = new Set<string>()
  for (const f of props.chapter.features) {
    for (const id of Object.keys(f.snippets)) ids.add(id)
  }
  return ids
})
const emptyText = (langId: string): string =>
  coveredLangs.value.has(langId) ? t('emptyCell') : t('emptyCellOutOfScope')
</script>

<template>
  <div>
    <section v-for="feature in features" :key="feature.id" class="pc-panel" style="margin-bottom: 16px">
      <header class="pc-page-head" style="margin-bottom: 10px">
        <h2 style="font-size: var(--pc-fs-xl)">
          <RouterLink :to="`/feature/${feature.id}`">{{ feature.title }}</RouterLink>
        </h2>
        <div style="display: flex; gap: 6px; align-items: center; margin: 4px 0">
          <span class="pc-tag">{{ feature.kind }}</span>
          <EquivalenceBadge
            v-for="s in Object.values(feature.snippets)"
            :key="s.lang"
            :value="s.equivalence"
          />
        </div>
        <p v-if="feature.summary">{{ feature.summary }}</p>
      </header>

      <div v-if="feature.bodyHtml" class="pc-md" style="margin-bottom: 12px" v-html="feature.bodyHtml" />

      <div class="pc-cards">
        <article v-for="lang in columns" :key="`${feature.id}-${lang.id}`" class="pc-card">
          <div class="pc-card-head">
            <strong>{{ lang.name }}</strong>
            <span class="pc-hint">{{ lang.fileExtension }}</span>
          </div>
          <div class="pc-card-body">
            <CodeBlock
              v-if="feature.snippets[lang.id]"
              :snippet="feature.snippets[lang.id]!"
              :lang-meta="lang"
            />
            <p v-else class="pc-hint">{{ emptyText(lang.id) }}</p>
          </div>
        </article>
      </div>
    </section>

    <div v-if="!features.length" class="pc-empty">{{ t('allSame') }}</div>
  </div>
</template>
