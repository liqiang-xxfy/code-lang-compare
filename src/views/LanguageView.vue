<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getConcepts, manifest } from '@/content/repository'
import { enabledLanguageIds, equivalenceReferenceName, getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const { t } = useI18n()

const langId = computed(() => String(route.params.langId ?? ''))
const lang = computed(() => getLanguageMeta(langId.value))

usePageMeta(
  () => (lang.value ? `${lang.value.name} 对照入口` : undefined),
  () =>
    lang.value
      ? `${lang.value.name} 与 ${equivalenceReferenceName} 的心智模型对照、设计维度与生态差异。`
      : undefined,
)

/** 心智模型对照表本身就是 N 列结构，列随启用语言自动变化（v1 的两列结构装不下） */
const concepts = getConcepts()
const columns = enabledLanguageIds

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

const chapters = computed(() =>
  manifest.topics.flatMap((topic) =>
    topic.chapters.map((chapter) => ({ ...chapter, topicTitle: topic.title })),
  ),
)
</script>

<template>
  <div v-if="lang">
    <div class="pc-crumb">{{ t('nav.languages') }}</div>
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

    <section class="pc-panel" style="margin-bottom: 20px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 6px">心智模型对照</h2>
      <p class="pc-hint">前端世界 ↔ 目标世界。列数随启用的语言自动变化。</p>
      <div style="overflow-x: auto; margin-top: 10px">
        <table class="pc-table-simple">
          <thead>
            <tr>
              <th>概念</th>
              <th v-for="id in columns" :key="id">{{ getLanguageMeta(id)?.name ?? id }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="concept in concepts" :key="concept.id">
              <th scope="row">{{ concept.concept }}</th>
              <td v-for="id in columns" :key="`${concept.id}-${id}`">
                <template v-if="concept.entries[id]">
                  <strong>{{ concept.entries[id]!.label }}</strong>
                  <div class="pc-hint">{{ concept.entries[id]!.detail }}</div>
                </template>
                <span v-else class="pc-hint">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section style="margin-bottom: 20px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">章节入口</h2>
      <ul class="pc-tree">
        <li v-for="chapter in chapters" :key="chapter.id">
          <RouterLink :to="`/compare/${chapter.id}`">
            {{ chapter.topicTitle }} / {{ chapter.title }}
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
