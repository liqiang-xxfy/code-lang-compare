<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import { pickColumns } from '@/composables/useVisibleColumns'
import { getCachedBlockDiffs, getCachedDiff, type LineDiff } from '@/content/diff'
import { featureAnchor } from '@/content/repository'
import type { RenderedChapter, RenderedFeature } from '@/schemas'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ chapter: RenderedChapter; diffMode?: boolean }>()

const ui = useUiStore()
const languages = useLanguageStore()
const { t } = useI18n()

const rows = computed(() =>
  props.chapter.features.filter((feature) => {
    if (!ui.onlyDifferent) return true
    return Object.values(feature.snippets).some((s) => s.equivalence !== 'identical')
  }),
)

/**
 * 本章实际覆盖了哪些语言。
 *
 * 迁移教程的 topic 只覆盖 from/to 两门（topic.languages），其余列是**本方向不涉及**，
 * 而不是「尚未提供实现」—— 两种含义完全不同的空，用同一句文案会让读者以为内容缺失。
 */
const coveredLangs = computed(() => {
  const ids = new Set<string>()
  for (const f of props.chapter.features) {
    for (const id of Object.keys(f.snippets)) ids.add(id)
  }
  return ids
})
const emptyText = (langId: string): string =>
  coveredLangs.value.has(langId) ? t('emptyCell') : t('emptyCellOutOfScope')

/** 列裁到「本章真有实现」的语言，避免整列都是「本模块不涉及该语言」的噪音 */
const columns = computed(() => pickColumns(languages.orderedMeta, languages.baseline, coveredLangs.value))

/**
 * 徽章行用的列：**去掉基准语言**。
 * 基准相对它自己恒为「同构」，列进去只会给每一行都挂一个 `[JS =]` 的废话。
 */
const comparedColumns = computed(() =>
  columns.value.filter((lang) => lang.id !== languages.baseline),
)

/**
 * 基准列永远不画 diff（它是参照系本身）；diff 在运行时算，按 (feature,baseline,target) 缓存。
 *
 * 返回值与 `snippet.blocks` 按下标对齐，单段内容恒为长度 1。
 * 多段**必须逐段算** —— 每段各有自己的行号空间。
 */
function diffsFor(feature: RenderedFeature, langId: string): Array<LineDiff | null> | null {
  if (!props.diffMode || langId === languages.baseline) return null
  const base = feature.snippets[languages.baseline]
  const target = feature.snippets[langId]
  if (!base || !target) return null
  const key = `${feature.id}|${languages.baseline}|${langId}`

  const baseBlocks = base.blocks?.map((b) => b.code)
  const targetBlocks = target.blocks?.map((b) => b.code)
  if (baseBlocks?.length && targetBlocks?.length) {
    // 段数不同时返回 null —— 调用方据此显示「未做逐行对照」，而不是给一份错位的着色
    return getCachedBlockDiffs(key, baseBlocks, targetBlocks)
  }

  if (!base.code || !target.code) return null
  return [getCachedDiff(key, base.code, target.code)]
}

/** 两侧都是多段、但段数不同 —— 无法逐段对齐 */
function blocksMismatch(feature: RenderedFeature, langId: string): boolean {
  if (!props.diffMode || langId === languages.baseline) return false
  const base = feature.snippets[languages.baseline]
  const target = feature.snippets[langId]
  return Boolean(
    base?.blocks?.length && target?.blocks?.length && base.blocks.length !== target.blocks.length,
  )
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
        <tr v-for="feature in rows" :id="featureAnchor(feature.id)" :key="feature.id" class="pc-anchored">
          <th class="pc-col-feature" scope="row">
            <div class="pc-feature-cell">
              <RouterLink class="pc-feature-title" :to="`/feature/${feature.id}`">
                {{ feature.title }}
              </RouterLink>
              <div class="pc-feature-meta">
                <span class="pc-tag">{{ feature.kind }}</span>
                <!-- 同 SideBySideLayout：跟着当前可见的列走、标出语言名，基准列由 comparedColumns 排除 -->
                <template v-for="lang in comparedColumns" :key="lang.id">
                  <EquivalenceBadge
                    v-if="feature.snippets[lang.id]"
                    :value="feature.snippets[lang.id]!.equivalence"
                    :lang-name="lang.shortName"
                    :compact="true"
                  />
                </template>
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
                :diffs="diffsFor(feature, lang.id)"
                :blocks-mismatch="blocksMismatch(feature, lang.id)"
                :is-baseline="lang.id === languages.baseline"
              />
            </div>
            <div v-else class="pc-cell-empty">{{ emptyText(lang.id) }}</div>
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
