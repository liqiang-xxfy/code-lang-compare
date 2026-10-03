<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { firstChapterSection } from '@/content/repository'
import { sectionEntryPath } from '@/router'
import { defaultBaselineLanguageId } from '@/generated/registry.gen'

const { t } = useI18n()
usePageMeta(() => '页面不存在')

/** 兜底跳转：默认基准下第一个真正有内容的章节 */
const firstSection = firstChapterSection()
const firstPath = firstSection ? sectionEntryPath(defaultBaselineLanguageId, firstSection) : '/404'
</script>

<template>
  <div class="pc-empty">
    <h1 style="font-size: var(--pc-fs-2xl); margin-bottom: 10px">404 · 没有这个页面</h1>
    <p>可能链接拼错了，或者这个特性还没写。</p>
    <p style="margin-top: 14px">
      <RouterLink to="/">{{ t('backHome') }}</RouterLink>
      <template v-if="firstPath !== '/404'">
        · <RouterLink :to="firstPath">去第一条对照章节</RouterLink>
      </template>
    </p>
  </div>
</template>
