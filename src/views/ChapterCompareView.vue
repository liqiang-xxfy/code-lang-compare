<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CompareLanguageBar from '@/components/compare/CompareLanguageBar.vue'
import CompareSurface from '@/components/compare/CompareSurface.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { pickColumns } from '@/composables/useVisibleColumns'
import {
  chapterOf,
  chapterPathOf,
  hasBoxChapter,
  sectionDefOf,
  siblingsOf,
} from '@/content/repository'
import { sectionOfRoute } from '@/router'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { getLanguageMeta } from '@/generated/registry.gen'
import type { RenderedBoxChapter } from '@/schemas'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const { t } = useI18n()

const baselineId = computed(() => String(route.params.baseline ?? ''))
/**
 * 板块来自 `params.section` —— 曾写成 `route.name === '...' ? … : '...'`，
 * 于是任何新的章节型板块都会被当成另一类（去要一个它没有的东西）。
 * 守卫保证只有已注册的章节型板块能走到这里，null 只是类型上的兜底。
 */
const section = computed(() => sectionOfRoute(route))
/** 章节 id 即文件名，直接来自地址 —— v2 取消了 topic 这一层，不再需要反查 */
const chapterId = computed(() => String(route.params.chapter ?? ''))
/** 章节元数据来自**清单**（与语言无关），不再从分片里读 */
const chapter = computed(() => (section.value ? chapterOf(section.value, chapterId.value) : null))

/**
 * 可见列 = 基准 + 勾选的对比语言，并按「这一章真有分片」裁剪。
 *
 * 裁剪**不补位**（ADR-34）：勾选的语言一门都没写这一章时只留基准列。
 * 判据是「该语言本章有分片」（hasBoxChapter），不是「加载完了没有」——
 * 后者会让列在加载完成前后跳一次。
 */
const columns = computed(() => {
  const s = section.value
  if (!s) return []
  const present = new Set(
    languages.orderedMeta.map((m) => m.id).filter((id) => hasBoxChapter(id, s, chapterId.value)),
  )
  return pickColumns(languages.orderedMeta, baselineId.value, present)
})

const columnIds = computed(() => columns.value.map((m) => m.id))

/** 已加载的分片。没加载完的列会显示「加载中」而不是「还没写」*/
const shards = computed(() => {
  const s = section.value
  if (!s) return {} as Record<string, RenderedBoxChapter>
  const out: Record<string, RenderedBoxChapter> = {}
  for (const id of columnIds.value) {
    const shard = content.getBoxChapterRaw(id, s, chapterId.value)
    if (shard) out[id] = shard
  }
  return out
})

/**
 * 按需加载每一列的分片。
 *
 * 守卫已经加载过基准列那一份，但**换对比语言不产生导航** —— 用户只是在页内的
 * 语言选择条里勾了一门，路由没变，守卫不会重跑。少了这个 watcher，
 * 新勾的那一列会永远停在空白。
 */
watch(
  columnIds,
  (cols) => {
    const s = section.value
    if (!s || !cols.length) return
    void content.ensureColumns(s, chapterId.value, cols)
  },
  { immediate: true },
)

const nav = computed(() =>
  section.value ? siblingsOf(section.value, chapterId.value) : { prev: null, next: null },
)

const baselineName = computed(() => getLanguageMeta(baselineId.value)?.name ?? baselineId.value)

/** 章内还有多少格是「未经人工校对」的 draft */
const draftCount = computed(() => {
  let n = 0
  for (const shard of Object.values(shards.value)) {
    for (const box of Object.values(shard.boxes)) if (box.reviewState === 'draft') n += 1
  }
  return n
})

/** 板块名取自注册表 —— i18n 里那组按板块写死的 key 已随之废弃 */
const sectionLabel = computed(() => (section.value ? (sectionDefOf(section.value)?.title ?? '') : ''))

const pathOf = (c: { id: string }) =>
  section.value ? chapterPathOf(baselineId.value, section.value, c.id) : '/404'

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
      换到一个基准还没写的章节时 chapter 会短暂为 null，整块一起消失的话，
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

    <template v-if="chapter && section">
      <CompareSurface
        :section="section"
        :baseline="baselineId"
        :chapter="chapter"
        :columns="columns"
        :shards="shards"
      />

      <nav class="pc-chapter-nav" aria-label="章节导航">
        <RouterLink v-if="nav.prev" :to="pathOf(nav.prev)"> ← {{ nav.prev.title }} </RouterLink>
        <span />
        <RouterLink v-if="nav.next" :to="pathOf(nav.next)"> {{ nav.next.title }} → </RouterLink>
      </nav>
    </template>

    <!-- 装载失败与「还在加载」必须分开：失败会永远停在加载中的话，用户无从判断是慢还是坏了 -->
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
