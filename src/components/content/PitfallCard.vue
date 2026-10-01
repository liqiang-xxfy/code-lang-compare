<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import MarkdownContent from '@/components/content/MarkdownContent.vue'
import type { RenderedPitfall } from '@/schemas'

const props = defineProps<{ pitfall: RenderedPitfall; featureTitle?: string }>()

const stars = computed(
  () => '★'.repeat(props.pitfall.severity) + '☆'.repeat(3 - props.pitfall.severity),
)
</script>

<template>
  <!-- id 用于搜索结果锚点跳转（见 scripts/pipeline/search-index.ts 的 url 生成） -->
  <article :id="pitfall.id" class="pc-pitfall">
    <h3>
      <span class="pc-stars" :title="`严重度 ${pitfall.severity}/3`" aria-hidden="true">
        {{ stars }}
      </span>
      <span class="pc-visually-hidden">严重度 {{ pitfall.severity }}/3</span>
      {{ pitfall.title }}
    </h3>

    <div class="pc-feature-meta" style="margin-bottom: 8px">
      <span v-if="pitfall.fromBaseline" class="pc-tag" style="color: var(--pc-eq-divergent)">
        JS 开发者必踩
      </span>
      <span v-for="lang in pitfall.languages" :key="lang" class="pc-tag">{{ lang }}</span>
      <span v-for="tag in pitfall.tags" :key="tag" class="pc-tag">#{{ tag }}</span>
    </div>

    <dl>
      <dt>症状</dt>
      <dd><MarkdownContent :html="pitfall.symptomHtml" /></dd>
      <dt>原因</dt>
      <dd><MarkdownContent :html="pitfall.causeHtml" /></dd>
      <dt>解法</dt>
      <dd><MarkdownContent :html="pitfall.fixHtml" /></dd>
    </dl>

    <p v-if="pitfall.featureId" class="pc-hint" style="margin-bottom: 0; margin-top: 8px">
      相关特性：<RouterLink :to="`/feature/${pitfall.featureId}`">{{ featureTitle ?? pitfall.featureId }}</RouterLink>
    </p>
  </article>
</template>
