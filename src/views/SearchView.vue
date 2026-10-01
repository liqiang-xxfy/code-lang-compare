<script setup lang="ts">
/**
 * 速查 / 全文检索。
 *
 * 索引是**构建期**产出的（scripts/pipeline/search-index.ts），这里只做两件事：
 * 按需装载（动态 import，不进主包）与展示。中文检索的关键在 search-tokenize.ts。
 *
 * 为什么 `query` 是普通 ref 而不是 URL query：
 * 逐字检索会把每次按键都写进浏览器历史，返回键变得不可用。
 * 真要做「可分享的搜索结果」应当只在提交时写 URL，那是后续的事，不在这里加。
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type MiniSearch from 'minisearch'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { loadSearchIndex, toHits, type SearchDocType, type SearchHit } from '@/content/search'

const { t } = useI18n()

const total = ref(0)
usePageMeta(
  () => t('search.title'),
  () => t('search.lead', { count: total.value }),
)

const query = ref('')
const hits = shallowRef<SearchHit[]>([])
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')

/** 示例词刻意覆盖四类检索路径：中文词、代码符号、语言名组合、长词 */
const SUGGESTIONS = ['可变默认参数', '数组', 'toFixed', '?.', '除以零', '闭包']

let engine: MiniSearch<Record<string, unknown>> | null = null

function run() {
  const q = query.value.trim()
  if (!engine || !q) {
    hits.value = []
    return
  }
  hits.value = toHits(engine.search(q) as Array<Record<string, unknown>>)
}

onMounted(async () => {
  try {
    // 动态 import：索引单独成 chunk，只有进到本页才下载
    const mod = await import('@/generated/search-index.json')
    const payload = (mod.default ?? mod) as { index: string; docCount?: number }
    engine = loadSearchIndex(payload.index) as unknown as MiniSearch<Record<string, unknown>>
    total.value = payload.docCount ?? 0
    status.value = 'ready'
    run()
  } catch (err) {
    // 索引缺失不该让整页崩掉：降级为「引导用导航」，并留下可诊断的日志
    status.value = 'unavailable'
    console.error('[search] 索引装载失败', err)
  }
})

const ORDER: SearchDocType[] = ['feature', 'pitfall', 'glossary', 'concept', 'roadmap']

const grouped = computed(() =>
  ORDER.map((type) => ({
    type,
    items: hits.value.filter((h) => h.type === type),
  })).filter((g) => g.items.length > 0),
)

function pick(word: string) {
  query.value = word
  run()
}
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ t('search.title') }}</h1>
      <p>{{ t('search.lead', { count: total || '—' }) }}</p>
    </section>

    <div class="pc-panel">
      <form role="search" @submit.prevent="run">
        <label class="pc-search-field">
          <span class="pc-visually-hidden">{{ t('search.placeholder') }}</span>
          <input
            v-model="query"
            type="search"
            :placeholder="t('search.placeholder')"
            :disabled="status !== 'ready'"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @input="run"
          >
        </label>
      </form>

      <p v-if="status === 'loading'" class="pc-hint">{{ t('loading') }}</p>
      <p v-else-if="status === 'unavailable'" class="pc-hint">{{ t('search.unavailable') }}</p>

      <template v-else-if="!query.trim()">
        <p class="pc-hint">{{ t('search.tryTitle') }}</p>
        <ul class="pc-chip-row">
          <li v-for="word in SUGGESTIONS" :key="word">
            <button type="button" class="pc-chip" @click="pick(word)">{{ word }}</button>
          </li>
        </ul>
      </template>
    </div>

    <p v-if="status === 'ready' && query.trim() && hits.length === 0" class="pc-empty">
      {{ t('search.noResult', { q: query }) }}
    </p>

    <section v-for="group in grouped" :key="group.type" class="pc-panel">
      <h2 class="pc-search-group">
        {{ t(`search.type.${group.type}`) }}
        <span class="pc-count">{{ group.items.length }}</span>
      </h2>
      <ul class="pc-search-list">
        <li v-for="hit in group.items" :key="hit.id">
          <RouterLink :to="hit.url">{{ hit.title }}</RouterLink>
          <span class="pc-search-meta">{{ hit.meta }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
