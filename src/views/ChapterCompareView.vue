<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CompareSurface from '@/components/compare/CompareSurface.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const { t } = useI18n()
/** 同 FeatureView：对比页文案跟随运行时基准 */
const baselineName = computed(() => languages.metaOf(languages.baseline)?.name ?? languages.baseline)

const topicId = computed(() => String(route.params.topicId ?? ''))
const chapterSlug = computed(() => String(route.params.chapterSlug ?? ''))
const chapterId = computed(() => `${topicId.value}/${chapterSlug.value}`)

const chapter = computed(() => content.getChapterRaw(chapterId.value))

/** 章节的前后导航与 topic 标题都来自 manifest —— 不需要额外加载别的分片 */
const nav = computed(() => content.siblingsOf(chapterId.value))

const draftCount = computed(() => {
  const rows = chapter.value?.features ?? []
  let n = 0
  for (const f of rows) for (const s of Object.values(f.snippets)) if (s.reviewState === 'draft') n += 1
  return n
})

usePageMeta(
  () => (chapter.value ? `${nav.value.topicTitle} · ${chapter.value.title}` : undefined),
  () =>
    chapter.value
      ? `${chapter.value.title}：${chapter.value.features
          .slice(0, 6)
          .map((f) => f.title)
          .join('、')} 在 ${baselineName.value} 与其他语言中的写法对照。`
      : undefined,
)
</script>

<template>
  <div v-if="chapter">
    <div class="pc-crumb">
      <RouterLink to="/">{{ t('nav.home') }}</RouterLink> /
      <span>{{ nav.topicTitle }}</span> /
      <span>{{ chapter.title }}</span>
    </div>

    <section class="pc-page-head">
      <h1>{{ chapter.title }}</h1>
      <p v-if="chapter.summary">{{ chapter.summary }}</p>
      <p v-if="draftCount" class="pc-note-box" style="margin-top: 10px">
        {{ t('review.draftSection', { n: draftCount }) }}
      </p>
    </section>

    <CompareSurface :chapter="chapter" />

    <nav class="pc-chapter-nav" aria-label="章节导航">
      <RouterLink v-if="nav.prev" :to="`/compare/${nav.prev.id}`">
        ← {{ nav.prev.title }}
      </RouterLink>
      <span />
      <RouterLink v-if="nav.next" :to="`/compare/${nav.next.id}`">
        {{ nav.next.title }} →
      </RouterLink>
    </nav>
  </div>

  <div v-else class="pc-empty">{{ t('loading') }}</div>
</template>

<style scoped>
.pc-chapter-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--pc-border);
  font-size: var(--pc-fs-sm);
}
</style>
