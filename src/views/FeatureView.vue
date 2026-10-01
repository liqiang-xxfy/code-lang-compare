<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import EquivalenceReferenceNote from '@/components/compare/EquivalenceReferenceNote.vue'
import LanguagePicker from '@/components/compare/LanguagePicker.vue'
import MarkdownContent from '@/components/content/MarkdownContent.vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getCachedDiff } from '@/content/diff'
import { getPitfalls, manifest } from '@/content/repository'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const ui = useUiStore()
const { t } = useI18n()

const featureId = computed(() => `${String(route.params.topicId ?? '')}/${String(route.params.slug ?? '')}`)
const feature = computed(() => content.getFeatureRaw(featureId.value))
const columns = computed(() => languages.orderedMeta)
const info = computed(() => manifest.featureIndex[featureId.value])
/** 对比类页面用**运行时基准**做文案 —— 页面上的列与 diff 本来就是相对它渲染的 */
const baselineName = computed(() => languages.metaOf(languages.baseline)?.name ?? languages.baseline)

const relatedPitfalls = computed(() =>
  getPitfalls().filter((p) => p.featureId === featureId.value),
)

/**
 * 迁移教程的小节 → 概念详解的软引用（refFeatureId）。
 *
 * 迁移模块写自己的 snippet（视角不同、代码更聚焦），不复用 basics 的 feature
 * —— R8 强制 featureId 唯一且归属单一 chapter。这个链接让两边互相可达，
 * 把「两份对照代码各说各话」变成可点达的关系。
 */
const refFeature = computed(() => {
  const id = feature.value?.refFeatureId
  return id ? manifest.featureIndex[id] : undefined
})

/** 基准差异模式下给非基准列计算行级 diff（运行时算 + 缓存） */
function diffFor(langId: string) {
  if (ui.viewMode !== 'baseline-diff' || langId === languages.baseline) return null
  const base = feature.value?.snippets[languages.baseline]
  const target = feature.value?.snippets[langId]
  if (!base?.code || !target?.code) return null
  return getCachedDiff(`${featureId.value}|${languages.baseline}|${langId}`, base.code, target.code)
}

usePageMeta(
  () => (feature.value ? `${feature.value.title} 的跨语言对照` : undefined),
  () =>
    feature.value
      ? `${feature.value.title}：在 ${baselineName.value} 与其它语言中的写法、差异与迁移陷阱。${feature.value.summary ?? ''}`
      : undefined,
)
</script>

<template>
  <div v-if="feature">
    <div class="pc-crumb">
      <RouterLink to="/">{{ t('nav.home') }}</RouterLink> /
      <RouterLink v-if="info" :to="`/compare/${info.chapterId}`">{{ info.chapterId }}</RouterLink> /
      <span>{{ feature.title }}</span>
    </div>

    <section class="pc-page-head">
      <h1>{{ feature.title }}</h1>
      <div class="pc-feature-meta" style="margin: 6px 0">
        <span class="pc-tag">{{ feature.kind }}</span>
        <EquivalenceBadge
          v-for="s in Object.values(feature.snippets)"
          :key="s.lang"
          :value="s.equivalence"
        />
      </div>
      <p v-if="feature.summary">{{ feature.summary }}</p>
      <p v-if="refFeature" class="pc-hint" style="margin-top: 6px">
        概念详解：
        <RouterLink :to="`/feature/${feature.refFeatureId}`">{{ refFeature.title }} →</RouterLink>
      </p>
    </section>

    <MarkdownContent v-if="feature.bodyHtml" :html="feature.bodyHtml" class="pc-panel" style="margin-bottom: 18px" />

    <div class="pc-toolbar" style="margin-bottom: 10px">
      <LanguagePicker />
    </div>
    <EquivalenceReferenceNote />

    <div class="pc-cards">
      <article
        v-for="lang in columns"
        :key="lang.id"
        class="pc-card"
        :class="{ 'is-baseline': lang.id === languages.baseline }"
      >
        <div class="pc-card-head">
          <strong>{{ lang.name }}</strong>
          <span class="pc-hint">{{ lang.fileExtension }}</span>
          <span v-if="lang.id === languages.baseline" class="pc-tag">{{ t('baseline.label') }}</span>
        </div>
        <div class="pc-card-body">
          <CodeBlock
            v-if="feature.snippets[lang.id]"
            :snippet="feature.snippets[lang.id]!"
            :lang-meta="lang"
            :diff="diffFor(lang.id)"
            show-line-numbers
          />
          <p v-else class="pc-hint">{{ t('emptyCell') }}</p>
        </div>
      </article>
    </div>

    <section v-if="relatedPitfalls.length" style="margin-top: 24px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">相关迁移陷阱</h2>
      <div class="pc-grid-cards">
        <PitfallCard
          v-for="p in relatedPitfalls"
          :key="p.id"
          :pitfall="p"
          :feature-title="feature.title"
        />
      </div>
    </section>
  </div>

  <div v-else class="pc-empty">{{ t('loading') }}</div>
</template>

<style scoped>
.pc-card.is-baseline {
  border-color: var(--pc-accent);
}
</style>
