<script setup lang="ts">
/**
 * 速查 / 全文检索。
 *
 * 索引是**构建期**产出的（scripts/pipeline/search-index.ts），这里只做两件事：
 * 按需装载（动态 import，不进主包）与展示。中文检索的关键在 search-tokenize.ts。
 *
 * **检索词只在提交时写进 URL**（`?q=`）：逐字写会把每次按键都塞进浏览器历史，
 * 返回键随即不可用。提交时写则拿到「可分享的搜索结果」，两件事都成立 ——
 * 之前这里把「不逐字写」当成了「不写」，于是刷新或分享出去就丢了检索词。
 *
 * 索引按**语言**分片，这里加载的是**当前可见的那几门**（基准 + 勾选的对比语言），
 * 于是「搜到的」与「屏幕上能看到的列」天然一致，不需要再在本页做一个范围切换器。
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type MiniSearch from 'minisearch'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getSearchShard } from '@/content/repository'
import {
  loadSearchIndex,
  queryOptions,
  toHits,
  type SearchDocType,
  type SearchHit,
} from '@/content/search'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const languages = useLanguageStore()
const route = useRoute()
const router = useRouter()

/**
 * 检索范围 = 当前可见的语言（基准 + 勾选的对比语言）。
 *
 * 一个分片只装一门语言的文字，所以要加载多份并合并 —— 顺序按可见列的顺序，
 * 于是结果里的语言顺序与页面上一致。
 */
const scopeLangs = computed(() => {
  const ids = [languages.effectiveBaseline, ...languages.compareMeta.map((m) => m.id)]
  return [...new Set(ids)]
})
const scopeNames = computed(() =>
  scopeLangs.value.map((id) => languages.metaOf(id)?.name ?? id).join('、'),
)

const total = ref(0)
usePageMeta(
  () => t('search.title'),
  () => t('search.lead', { count: total.value, langs: scopeNames.value }),
)

/** 检索词。初值取地址里的 `?q=`，让分享出去的链接打开就是那次检索的结果 */
const query = ref(String(route.query.q ?? ''))
const hits = shallowRef<SearchHit[]>([])
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')

/**
 * 提交时把检索词写进地址。
 *
 * 用 `replace` 而不是 `push`：一次检索不该在历史里留下一条记录，
 * 否则用户按返回键会退回「检索前的同一个页面」，看起来像没反应。
 */
function syncQueryToUrl(): void {
  const q = query.value.trim()
  if (String(route.query.q ?? '') === q) return
  void router.replace({ query: { ...route.query, q: q || undefined } })
}

/** 地址被外部改变（深链、前进后退）时把输入框同步过来 */
watch(
  () => route.query.q,
  (next) => {
    const value = String(next ?? '')
    if (value !== query.value) {
      query.value = value
      run()
    }
  },
)

/** 示例词刻意覆盖四类检索路径：中文词、代码符号、语言名组合、长词 */
const SUGGESTIONS = ['可变默认参数', '数组', 'toFixed', '?.', '除以零', '闭包']

/** 每个语言分片一个引擎 —— 一个分片只装一门语言的文字，各搜各的再合并 */
let engines: Array<MiniSearch<Record<string, unknown>>> = []

function run() {
  const q = query.value.trim()
  if (!engines.length || !q) {
    hits.value = []
    return
  }
  /*
   * 各分片分别检索后合并。分片之间**没有重叠**（一门语言的文字只索引一次），
   * 所以不需要按 id 去重 —— 但排序要按得分，否则「先加载的那门语言」永远排在前面。
   */
  const merged = engines.flatMap(
    (engine) => engine.search(q, queryOptions()) as Array<Record<string, unknown>>,
  )
  merged.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
  hits.value = toHits(merged)
}

async function loadShards(langs: readonly string[]): Promise<void> {
  status.value = 'loading'
  try {
    const payloads = await Promise.all(langs.map((id) => getSearchShard(id)))
    const found = payloads.filter((p): p is NonNullable<typeof p> => Boolean(p))
    if (!found.length) throw new Error(`没有可用的索引分片：${langs.join(', ')}`)
    engines = found.map(
      (p) => loadSearchIndex(p.index) as unknown as MiniSearch<Record<string, unknown>>,
    )
    total.value = found.reduce((n, p) => n + (p.docCount ?? 0), 0)
    status.value = 'ready'
    run()
  } catch (err) {
    // 索引缺失不该让整页崩掉：降级为「引导用导航」，并留下可诊断的日志
    status.value = 'unavailable'
    console.error('[search] 索引装载失败', err)
  }
}

onMounted(() => {
  void loadShards(scopeLangs.value)
})

watch(scopeLangs, (next) => {
  engines = []
  hits.value = []
  void loadShards(next)
})

const ORDER: SearchDocType[] = ['feature', 'pitfall', 'glossary', 'roadmap']

const grouped = computed(() =>
  ORDER.map((type) => ({
    type,
    items: hits.value.filter((h) => h.type === type),
  })).filter((g) => g.items.length > 0),
)

function pick(word: string) {
  query.value = word
  run()
  // 点示例词也是一次明确的检索动作，同样写进地址（便于分享这一次的结果）
  syncQueryToUrl()
}

/**
 * 点结果时把该条所属的方向并进选择。
 *
 * 目标语言不在地址里，所以一条「Javascript → Go 的陷阱」结果会链到
 * `/compare/javascript/pitfalls` —— 光靠地址还原不出方向。不在这里补一手的话，
 * 用户点了 Go 的坑却看到 Python 的内容，是那种"看起来像坏了"的体验。
 */
function onHit(hit: SearchHit): void {
  if (hit.target) languages.preferTarget(hit.target)
}
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ t('search.title') }}</h1>
      <p>{{ t('search.lead', { count: total || '—', langs: scopeNames }) }}</p>
      <p class="pc-hint" style="margin-top: 6px">
        {{ t('search.scopeNote', { langs: scopeNames }) }}
      </p>
    </section>

    <div class="pc-panel">
      <form role="search" @submit.prevent="syncQueryToUrl">
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
          <RouterLink :to="hit.url" @click="onHit(hit)">{{ hit.title }}</RouterLink>
          <span class="pc-search-meta">{{ hit.meta }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

