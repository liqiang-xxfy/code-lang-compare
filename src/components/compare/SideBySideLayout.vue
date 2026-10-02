<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import { pickColumns } from '@/composables/useVisibleColumns'
import { featureAnchor } from '@/content/repository'
import type { RenderedChapter } from '@/schemas'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ chapter: RenderedChapter }>()

const ui = useUiStore()
const languages = useLanguageStore()
const { t } = useI18n()

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

/** 同 MatrixLayout：列裁到本章真有实现的语言 */
const columns = computed(() => pickColumns(languages.orderedMeta, languages.baseline, coveredLangs.value))

/**
 * 徽章行用的列：**去掉基准语言**。
 *
 * 基准相对它自己恒为「同构」，列进去只会给每一条都挂上一个 `[JS =]` ——
 * 一句没有信息量的废话。这一行要说的是「其余语言各自与基准是什么关系」。
 */
const comparedColumns = computed(() =>
  columns.value.filter((lang) => lang.id !== languages.baseline),
)
</script>

<template>
  <div>
    <section
      v-for="feature in features"
      :id="featureAnchor(feature.id)"
      :key="feature.id"
      class="pc-panel pc-anchored"
      style="margin-bottom: 16px"
    >
      <header class="pc-page-head" style="margin-bottom: 10px">
        <h2 style="font-size: var(--pc-fs-xl)">
          <RouterLink :to="`/feature/${feature.id}`">{{ feature.title }}</RouterLink>
        </h2>
        <div class="pc-eq-row">
          <span class="pc-tag">{{ feature.kind }}</span>
          <!--
            徽章跟着**当前可见的列**走，不是跟着"所有有实现的语言"走。
            后者会排出用户根本没在看的语言（勾了两列却出现五个徽章），
            而且顺序是字典序、与列的排列对不上 —— 加语言名才有意义。
            基准列已由 comparedColumns 排除。
          -->
          <template v-for="lang in comparedColumns" :key="lang.id">
            <EquivalenceBadge
              v-if="feature.snippets[lang.id]"
              :value="feature.snippets[lang.id]!.equivalence"
              :lang-name="lang.shortName"
            />
          </template>
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
              :is-baseline="lang.id === languages.baseline"
            />
            <p v-else class="pc-hint">{{ emptyText(lang.id) }}</p>
          </div>
        </article>
      </div>
    </section>

    <div v-if="!features.length" class="pc-empty">{{ t('allSame') }}</div>
  </div>
</template>
