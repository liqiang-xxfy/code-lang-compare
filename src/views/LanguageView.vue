<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import {
  chaptersOf,
  chapterPathOf,
  firstChapterSection,
  hasBoxChapter,
  manifest,
  orderedSections,
} from '@/content/repository'
import { sectionEntryPath } from '@/router'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const { t } = useI18n()

const langId = computed(() => String(route.params.langId ?? ''))
const lang = computed(() => getLanguageMeta(langId.value))
const nameOf = (id: string) => getLanguageMeta(id)?.name ?? id

usePageMeta(
  () => (lang.value ? `${lang.value.name} 对照入口` : undefined),
  () =>
    lang.value ? `${lang.value.name} 的语言设计维度、生态差异与相关章节入口。` : undefined,
)

/**
 * 语言入口页的两条通路。
 *
 * 三轴模型下「一门语言」有两种身份：**基准**（它是参照系）与**目标**（它被对照）。
 * 一门语言可以两者兼具 —— 所以在同一页把两条入口都列出来，而不是二选一。
 */
const asBaseline = computed(() => {
  const section = firstChapterSection()
  if (!section) return null
  // 落到**这门语言确实写了**的第一章，而不是清单首章 —— 后者可能还没内容
  const first = chaptersOf(section).find((c) => hasBoxChapter(langId.value, section, c.id))
  return first ? chapterPathOf(langId.value, section, first.id) : null
})

const asTarget = computed(() =>
  manifest.pairs
    .filter((p) => p.target === langId.value)
    .map((p) => {
      // 优先给章节型板块的入口（内容最厚），否则退到该方向第一个有内容的板块
      const section =
        orderedSections().find((s) => s.shape === 'chapter' && p.sections.includes(s.id))?.id ??
        p.sections[0]
      return {
        baseline: p.baseline,
        /*
         * 这里曾拼成 `/compare/<基准>/<板块>/<目标语言>` —— 把目标语言塞进了章节 slug 的位置。
         * 它靠守卫的「slug 不存在就回落到首章」侥幸能打开，但地址本身是错的。
         * 目标语言不进 URL，落点应当走 sectionEntryPath。
         */
        to: section ? sectionEntryPath(p.baseline, section) : '/404',
      }
    }),
)

const languageFacts = computed(() => {
  const meta = lang.value
  if (!meta) return []
  return [
    ['类型系统', meta.typing === 'static' ? '静态' : meta.typing === 'gradual' ? '渐进' : '动态'],
    [
      '类型检查方式',
      meta.typeSystem === 'nominal' ? '名义类型' : meta.typeSystem === 'structural' ? '结构化类型' : '—',
    ],
    [
      '内存模型',
      meta.memoryModel === 'gc' ? '垃圾回收' : meta.memoryModel === 'arc' ? '引用计数（ARC）' : '手动管理',
    ],
    ['并发模型', meta.concurrency.join('、') || '—'],
    ['范式', meta.paradigm.join('、') || '—'],
  ] as Array<[string, string]>
})

/**
 * 本语言写了内容的章节 —— 判据是**它真有这一章的分片**。
 *
 * 清单与语言无关（三个基准共用同一套章节），所以「本语言相关」这件事只能由
 * 「写没写」回答。此前这里是 `manifest.topics.flatMap(...)`，
 * **一门语言的页面列出了全站所有章节**。
 */
const chapters = computed(() =>
  orderedSections()
    .filter((s) => s.shape === 'chapter')
    .flatMap((s) =>
      chaptersOf(s.id)
        .filter((c) => hasBoxChapter(langId.value, s.id, c.id))
        .map((c) => ({
          id: c.id,
          title: c.title,
          sectionTitle: s.title,
          to: chapterPathOf(langId.value, s.id, c.id),
        })),
    ),
)
</script>

<template>
  <div v-if="lang">
    <PageCrumb
      :items="[
        { label: t('nav.home'), to: '/' },
        { label: t('nav.languages') },
        { label: lang.name },
      ]"
    />
    <section class="pc-page-head">
      <h1>{{ lang.name }}</h1>
      <p v-if="lang.version" class="pc-hint">内容基于版本 {{ lang.version }}</p>
      <dl class="pc-meta-table">
        <template v-for="[key, value] in languageFacts" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
      <p v-if="lang.metadata" class="pc-hint" style="margin-top: 10px">
        <span v-for="(v, k) in lang.metadata" :key="k" class="pc-tag" style="margin-right: 6px">
          {{ k }}: {{ v }}
        </span>
      </p>
    </section>

    <!--
      这里曾有一张「心智模型对照」只读大表。它已经升级成正式的「心智模型」板块
      （左栏可进、按基准分章、可多列并排、可被检索），页面里再留一张就是两套真相。
    -->

    <section class="pc-panel" style="margin-bottom: 20px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 6px">两种进入方式</h2>
      <p class="pc-hint">
        一门语言在对比里可以是**参照系**（作为基准），也可以是**被对照的一方**（作为目标）。
      </p>
      <ul class="pc-tree" style="margin-top: 10px">
        <li v-if="asBaseline">
          <RouterLink :to="asBaseline">以 {{ lang.name }} 为基准浏览基础语法 →</RouterLink>
        </li>
        <li v-for="entry in asTarget" :key="entry.baseline">
          <RouterLink :to="entry.to">
            {{ nameOf(entry.baseline) }} → {{ lang.name }} 的迁移内容 →
          </RouterLink>
        </li>
      </ul>
      <p v-if="!asBaseline && !asTarget.length" class="pc-hint">
        这门语言目前既不是基准候选，也还没有以它为目标的迁移内容。
      </p>
    </section>

    <section style="margin-bottom: 20px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">章节入口</h2>
      <ul class="pc-tree">
        <li v-for="chapter in chapters" :key="`${chapter.sectionTitle}/${chapter.id}`">
          <RouterLink :to="chapter.to">
            {{ chapter.sectionTitle }} / {{ chapter.title }}
          </RouterLink>
        </li>
      </ul>
    </section>

    <section v-if="lang.links.length" class="pc-panel">
      <h2 style="font-size: var(--pc-fs-lg); margin-bottom: 8px">官方资源</h2>
      <ul>
        <li v-for="link in lang.links" :key="link.url">
          <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
        </li>
      </ul>
    </section>
  </div>

  <div v-else class="pc-empty">{{ t('empty') }}</div>
</template>

<style scoped>
.pc-meta-table {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 12px 0 0;
  font-size: var(--pc-fs-sm);
}
.pc-meta-table dt {
  color: var(--pc-text-mute);
  font-weight: 600;
}
.pc-meta-table dd {
  margin: 0;
  color: var(--pc-text-soft);
}
</style>
