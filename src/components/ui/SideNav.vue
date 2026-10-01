<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { hasRoadmap, manifest } from '@/content/repository'
import { enabledLanguageMeta } from '@/generated/registry.gen'

const { t } = useI18n()

/** 只为「确实已有路线图」的语言生成链接，避免死链 */
const roadmapLanguages = computed(() => enabledLanguageMeta.filter((m) => hasRoadmap(m.id)))
</script>

<template>
  <aside class="pc-side" aria-label="内容导航">
    <ul class="pc-tree">
      <li><RouterLink to="/search">{{ t('nav.search') }}</RouterLink></li>

      <li class="pc-tree-group">{{ t('nav.languages') }}</li>
      <li v-for="lang in enabledLanguageMeta" :key="lang.id">
        <RouterLink :to="`/lang/${lang.id}`">{{ lang.name }}</RouterLink>
      </li>

      <template v-for="topic in manifest.topics" :key="topic.id">
        <li class="pc-tree-group">{{ topic.title }}</li>
        <li v-for="chapter in topic.chapters" :key="chapter.id">
          <RouterLink :to="`/compare/${chapter.id}`">{{ chapter.title }}</RouterLink>
        </li>
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
