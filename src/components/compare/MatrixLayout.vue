<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import { badgeOf, explanationOf } from '@/content/boxView'
import { featureAnchor, featurePathOf } from '@/content/repository'
import type { CatalogChapter, LanguageMeta, RenderedBox, Section } from '@/schemas'

/**
 * 矩阵：行 = **该基准的**章节分组里的 feature，列 = 可见语言，格 = 对比框。
 *
 * 行来自「当前基准的章节分类」（每个基准一套，ADR-52），格来自各语言的内容分片。
 * 所以「换基准」换的是整套行与章节名，「换对比语言」只是多挂一列 —— 而格子本身
 * 只由 (语言, feature) 决定，两种情况都是同一批格子的重新取用。
 */
const props = defineProps<{
  section: Section
  baseline: string
  chapter: CatalogChapter
  columns: LanguageMeta[]
  /** 已加载的格子，key = 语言 id → feature id。缺的那个语言先按「加载中」渲染 */
  boxes: Record<string, Record<string, RenderedBox>>
}>()

const { t } = useI18n()

/** 全局 feature id = `<板块>/<feature>` —— 锚点与详情页链接都用它，不含章（章随基准变） */
const gidOf = (featureId: string) => `${props.section}/${featureId}`
const boxOf = (featureId: string, lang: string): RenderedBox | undefined =>
  props.boxes[lang]?.[featureId]

/** 行**就是**该基准这一章声明的 features —— 排序与取舍都在章节分组里，视图不再过筛 */
const rows = computed(() => props.chapter.features)

/** 徽章行用的列：去掉基准（那枚「=」是自指、零信息量） */
const comparedColumns = computed(() => props.columns.filter((l) => l.id !== props.baseline))
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
            :class="{ 'is-baseline-col': lang.id === baseline }"
          >
            {{ lang.name }}
            <span v-if="lang.id === baseline" class="pc-hint">（基准）</span>
            <span v-if="lang.version" class="pc-hint">{{ lang.version }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="feature in rows" :id="featureAnchor(gidOf(feature.id))" :key="feature.id" class="pc-anchored">
          <th class="pc-col-feature" scope="row">
            <div class="pc-feature-cell">
              <RouterLink class="pc-feature-title" :to="featurePathOf(gidOf(feature.id))">
                {{ feature.title }}
              </RouterLink>
              <div class="pc-feature-meta">
                <span class="pc-tag">{{ feature.kind }}</span>
                <!-- 跟着当前可见的列走、标出语言名，基准列由 comparedColumns 排除 -->
                <template v-for="lang in comparedColumns" :key="lang.id">
                  <EquivalenceBadge
                    v-if="boxOf(feature.id, lang.id) && badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
                    :value="badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)!"
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
            :class="{ 'is-baseline-col': lang.id === baseline }"
          >
            <div v-if="boxOf(feature.id, lang.id)" class="pc-cell-inner">
              <CodeBlock
                :box="boxOf(feature.id, lang.id)!"
                :lang-meta="lang"
                :explanation-html="explanationOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
                :equivalence="badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
                :is-baseline="lang.id === baseline"
              />
            </div>
            <!-- 分片还没加载完 —— 与「这门语言没写这一格」是两回事 -->
            <div v-else-if="!boxes[lang.id]" class="pc-cell-unwritten">{{ t('loading') }}</div>
            <div v-else class="pc-cell-unwritten">{{ t('emptyCell') }}</div>
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
