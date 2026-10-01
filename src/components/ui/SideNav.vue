<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { hasRoadmap, manifest } from '@/content/repository'
import { enabledLanguageMeta } from '@/generated/registry.gen'

const { t } = useI18n()

/** 只为「确实已有路线图」的语言生成链接，避免死链 */
const roadmapLanguages = computed(() => enabledLanguageMeta.filter((m) => hasRoadmap(m.id)))

/**
 * 按 topic.kind 分组。
 *
 * 两类内容的性质不同：概念对比是「这门语言怎么表达这个概念」，
 * 迁移教程是「带着 A 的习惯写 B 会踩什么」。混在一条平铺列表里，
 * 迁移方向一多就完全扫不动了。分组只依赖 manifest 里的 kind，不需要新路由。
 */
const conceptTopics = computed(() => manifest.topics.filter((t) => t.kind !== 'migration'))
const migrationTopics = computed(() => manifest.topics.filter((t) => t.kind === 'migration'))
</script>

<template>
  <aside class="pc-side" aria-label="内容导航">
    <ul class="pc-tree">
      <li><RouterLink to="/search">{{ t('nav.search') }}</RouterLink></li>

      <li class="pc-tree-group">{{ t('nav.languages') }}</li>
      <li v-for="lang in enabledLanguageMeta" :key="lang.id">
        <RouterLink :to="`/lang/${lang.id}`">{{ lang.name }}</RouterLink>
      </li>

      <template v-for="topic in conceptTopics" :key="topic.id">
        <li class="pc-tree-group">{{ topic.title }}</li>
        <li v-for="chapter in topic.chapters" :key="chapter.id">
          <RouterLink :to="`/compare/${chapter.id}`">{{ chapter.title }}</RouterLink>
        </li>
      </template>

      <template v-if="migrationTopics.length">
        <li class="pc-tree-group">{{ t('nav.migrations') }}</li>
        <template v-for="topic in migrationTopics" :key="topic.id">
          <!-- 迁移方向（JavaScript → Python）比章节名更能指引找路，所以两级都显示 -->
          <li class="pc-tree-sub">{{ topic.title }}</li>
          <li v-for="chapter in topic.chapters" :key="chapter.id">
            <RouterLink :to="`/compare/${chapter.id}`">{{ chapter.title }}</RouterLink>
          </li>
        </template>
      </template>

      <li class="pc-tree-group">{{ t('nav.pitfalls') }}</li>
      <li><RouterLink to="/pitfalls">{{ t('nav.pitfalls') }}</RouterLink></li>
      <li><RouterLink to="/glossary">{{ t('nav.glossary') }}</RouterLink></li>
      <li v-for="lang in roadmapLanguages" :key="`rm-${lang.id}`">
        <RouterLink :to="`/roadmap/${lang.id}`">{{ lang.name }} {{ t('nav.roadmap') }}</RouterLink>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
/* 迁移方向标签：比章节名轻，但比普通链接重 —— 承担分组作用 */
.pc-tree-sub {
  font-size: var(--pc-fs-xs);
  color: var(--pc-text-soft);
  margin-top: 6px;
  padding-left: 8px;
  letter-spacing: 0.02em;
}
</style>
