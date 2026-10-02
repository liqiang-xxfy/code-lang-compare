<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import CompareLanguageBar from '@/components/compare/CompareLanguageBar.vue'
import CompareSurface from '@/components/compare/CompareSurface.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { chapterPathOf, manifest, sectionDefOf, topicIdOf } from '@/content/repository'
import { sectionOfRoute } from '@/router'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const router = useRouter()
const content = useContentStore()
const languages = useLanguageStore()
const { t } = useI18n()

const baselineId = computed(() => String(route.params.baseline ?? ''))
/**
 * 板块来自 `params.section` —— 曾写成 `route.name === 'compare-basics' ? … : 'migration'`，
 * 于是任何新的章节型板块都会被当成迁移教程（去要一个它没有的 target）。
 * 守卫保证只有已注册的章节型板块能走到这里，null 只是类型上的兜底。
 */
const section = computed(() => sectionOfRoute(route))
/**
 * topicId 是**派生量**：路由里只有 (基准, 章节 slug)，目标语言来自页内选择条，
 * 章节 id 靠 manifest 反查。反查集中在 repository.topicIdOf —— 不要自己拼字符串。
 */
const topicId = computed(() => {
  const s = section.value
  if (!s) return ''
  return topicIdOf(baselineId.value, s, languages.pairTarget ?? undefined) ?? ''
})
const chapterId = computed(() => `${topicId.value}/${String(route.params.chapterSlug ?? '')}`)
const chapter = computed(() => content.getChapterRaw(chapterId.value))
const nav = computed(() => content.siblingsOf(chapterId.value))

/**
 * 章节按需加载。
 *
 * 守卫已经加载过一份，但**换目标语言不产生导航** —— 用户只是在页内的
 * 语言选择条里换了方向，路由没变，守卫不会重跑。少了这个 watcher，
 * 页面会停在"加载中…"。
 */
watch(
  chapterId,
  (id) => {
    if (id && !content.getChapterRaw(id)) void content.ensureChapter(id)
  },
  { immediate: true },
)

/**
 * 换方向后原来那一章可能在新方向下不存在（骨架期各方向的章数不同）。
 *
 * 目标不进 URL ⇒ 页内换方向不产生导航，路由守卫不重跑，上面那个 watcher 也
 * 只会拿到一个不存在分片 —— 页面就此停在"加载中…"。这里补上守卫里那段
 * 同意图的回落（guards.ts），两者条件正交：守卫只在**导航**时跑，这里只在
 * **纯状态变更**时跑，replace 之后 slug 必然存在于新 topic，不会来回跳。
 *
 * 注意：当前 manifest 里 6 个 migration topic 每个都只有 1 章且都叫
 * `01-functions`，所以这段骨架期不可达。留着是为了方向补齐章节之后，
 * 缺章不会静默变成一整页空白。
 */
watch(topicId, (id) => {
  if (!id) return
  const slug = String(route.params.chapterSlug ?? '')
  const topic = manifest.topics.find((t) => t.id === id)
  if (!topic || topic.chapters.some((c) => c.id.split('/')[1] === slug)) return
  const first = topic.chapters[0]
  if (first) void router.replace(chapterPathOf(first.id))
})

const baselineName = computed(
  () => getLanguageMeta(baselineId.value)?.name ?? baselineId.value,
)

const draftCount = computed(() => {
  const rows = chapter.value?.features ?? []
  let n = 0
  for (const f of rows) for (const s of Object.values(f.snippets)) if (s.reviewState === 'draft') n += 1
  return n
})

/** 板块名取自注册表 —— i18n 里那组按板块写死的 key 已随之废弃 */
const sectionLabel = computed(() =>
  section.value ? (sectionDefOf(section.value)?.title ?? '') : '',
)

usePageMeta(
  () => (chapter.value ? `${sectionLabel.value} · ${chapter.value.title}` : undefined),
  () =>
    chapter.value
      ? `${chapter.value.title}：${chapter.value.features
          .slice(0, 6)
          .map((f) => f.title)
          .join('、')} —— 以 ${baselineName.value} 为基准的对照。`
      : undefined,
)
</script>

<template>
  <div>
    <!--
      页面骨架（面包屑 / 标题）与语言选择条**不放进同一个 v-if**：
      换到一个没有该章节的方向时 chapter 会短暂为 null，整块一起消失的话，
      用户刚点的那个控件会在最需要他再操作一次的时候不见。
    -->
    <template v-if="chapter">
      <PageCrumb
        :items="[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.compare') },
          { label: sectionLabel },
          { label: chapter.title },
        ]"
      />

      <section class="pc-page-head">
        <h1>{{ chapter.title }}</h1>
        <p v-if="chapter.summary">{{ chapter.summary }}</p>
        <p v-if="draftCount" class="pc-note-box" style="margin-top: 10px">
          {{ t('review.draftSection', { n: draftCount }) }}
        </p>
      </section>
    </template>

    <!-- 多选（多列并排）还是单选（一篇文章），由板块注册表的 columns 决定 -->
    <CompareLanguageBar v-if="section" :section="section" />

    <template v-if="chapter">
      <CompareSurface :chapter="chapter" />

      <nav class="pc-chapter-nav" aria-label="章节导航">
        <RouterLink v-if="nav.prev" :to="chapterPathOf(nav.prev.id)">
          ← {{ nav.prev.title }}
        </RouterLink>
        <span />
        <RouterLink v-if="nav.next" :to="chapterPathOf(nav.next.id)">
          {{ nav.next.title }} →
        </RouterLink>
      </nav>
    </template>

    <!-- 装载失败与「还在加载」必须分开：此前 ensureChapter 没有 catch，失败会永远停在加载中 -->
    <p v-else-if="content.error" class="pc-empty">
      {{ t('loadFailed') }}
      <span class="pc-hint" style="display: block; margin-top: 8px">{{ content.error }}</span>
    </p>
    <div v-else class="pc-empty">{{ t('loading') }}</div>
  </div>
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
