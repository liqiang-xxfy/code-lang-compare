<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import { badgeOf, explanationOf } from '@/content/boxView'
import { featureAnchor, featurePathOf } from '@/content/repository'
import type {
  CatalogChapter,
  LanguageMeta,
  RenderedBox,
  RenderedBoxChapter,
  Section,
} from '@/schemas'
import { useUiStore } from '@/stores/ui'

/**
 * 并排卡片：每个 feature 一块面板，面板里每门语言一张卡。
 *
 * 与矩阵共用同一份数据与同一套列 —— 切模式不换页，只是同一批对比框换个排法。
 * v2 里**没有跨列的共享说明**：说明写在每一格自己的第 ③ 槽里
 * （基准列是这门语言的事实，对比列是它与基准的差别），卡片里各说各的。
 */
const props = defineProps<{
  section: Section
  baseline: string
  chapter: CatalogChapter
  columns: LanguageMeta[]
  shards: Record<string, RenderedBoxChapter>
}>()

const ui = useUiStore()
const { t } = useI18n()

const gidOf = (featureId: string) => `${props.section}/${props.chapter.id}/${featureId}`
const boxOf = (featureId: string, lang: string): RenderedBox | undefined =>
  props.shards[lang]?.boxes[featureId]

const features = computed(() =>
  props.chapter.features.filter((f) => {
    if (!ui.onlyDifferent) return true
    return props.columns.some((l) => {
      const box = boxOf(f.id, l.id)
      if (!box) return false
      const badge = badgeOf(box, l.id, props.baseline)
      return badge !== null && badge !== 'identical'
    })
  }),
)

/** 徽章行去掉基准列 —— 那枚「=」是自指、零信息量 */
const comparedColumns = computed(() => props.columns.filter((l) => l.id !== props.baseline))
</script>

<template>
  <div>
    <section
      v-for="feature in features"
      :id="featureAnchor(gidOf(feature.id))"
      :key="feature.id"
      class="pc-panel pc-anchored"
      style="margin-bottom: 16px"
    >
      <header class="pc-page-head" style="margin-bottom: 10px">
        <h2 style="font-size: var(--pc-fs-xl)">
          <RouterLink :to="featurePathOf(gidOf(feature.id))">{{ feature.title }}</RouterLink>
        </h2>
        <div class="pc-eq-row">
          <span class="pc-tag">{{ feature.kind }}</span>
          <!--
            徽章跟着**当前可见的列**走，不是跟着"所有有实现的语言"走。
            后者会排出用户根本没在看的语言（勾了两列却出现五个徽章），
            而且顺序是字典序、与列的排列对不上 —— 加语言名才有意义。
          -->
          <template v-for="lang in comparedColumns" :key="lang.id">
            <EquivalenceBadge
              v-if="boxOf(feature.id, lang.id) && badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
              :value="badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)!"
              :lang-name="lang.shortName"
            />
          </template>
        </div>
        <p v-if="feature.summary">{{ feature.summary }}</p>
      </header>

      <div class="pc-cards">
        <article v-for="lang in columns" :key="`${feature.id}-${lang.id}`" class="pc-card">
          <div class="pc-card-head">
            <strong>{{ lang.name }}</strong>
            <span class="pc-hint">{{ lang.fileExtension }}</span>
          </div>
          <div class="pc-card-body">
            <CodeBlock
              v-if="boxOf(feature.id, lang.id)"
              :box="boxOf(feature.id, lang.id)!"
              :lang-meta="lang"
              :explanation-html="explanationOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
              :equivalence="badgeOf(boxOf(feature.id, lang.id)!, lang.id, baseline)"
              :is-baseline="lang.id === baseline"
            />
            <!-- 分片还没加载完，与「这门语言没写这一格」是两回事 -->
            <p v-else-if="!shards[lang.id]" class="pc-hint">{{ t('loading') }}</p>
            <p v-else class="pc-hint">{{ t('emptyCell') }}</p>
          </div>
        </article>
      </div>
    </section>

    <div v-if="!features.length" class="pc-empty">{{ t('allSame') }}</div>
  </div>
</template>
