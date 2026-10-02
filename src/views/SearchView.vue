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
 * 基准也进了 URL（`?baseline=`）：速查页原本只有一句「要搜另一套，先去多语言对比里
 * 切基准」，等于把用户赶出当前页。索引本来就按基准分片，就地切是自然的。
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
import { getLanguageMeta } from '@/generated/registry.gen'

const { t } = useI18n()
const languages = useLanguageStore()
const route = useRoute()
const router = useRouter()

/**
 * 当前检索哪一套内容。
 *
 * 优先读地址里的 `?baseline=`（可分享），其次用「上次选择」（localStorage；
 * SSG 期不可用 → 默认基准）。索引按基准分片，切基准要换分片 ——
 * 三套内容全塞一份索引会到三倍体积，而用户一次只关心一套。
 */
const baseline = computed(() => {
  const fromUrl = String(route.query.baseline ?? '')
  return languages.baselineCandidates.some((m) => m.id === fromUrl)
    ? fromUrl
    : languages.effectiveBaseline
})
const baselineName = computed(() => getLanguageMeta(baseline.value)?.name ?? baseline.value)

/** 就地换基准：记住选择（供其它页用）并把基准写进地址，不离开速查页 */
function pickBaseline(id: string): void {
  if (id === baseline.value) return
  languages.rememberBaseline(id)
  void router.replace({ query: { ...route.query, baseline: id } })
}

const total = ref(0)
usePageMeta(
  () => t('search.title'),
  () => t('search.lead', { count: total.value, baseline: baselineName.value }),
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

let engine: MiniSearch<Record<string, unknown>> | null = null

function run() {
  const q = query.value.trim()
  if (!engine || !q) {
    hits.value = []
    return
  }
  /*
   * 查询选项必须显式带上基准：MiniSearch 的 loadJSON 不会记住 filter，
   * 而索引里同时有三套内容 —— 不传就等着同一个概念出三条近似结果。
   */
  hits.value = toHits(
    engine.search(q, queryOptions(baseline.value)) as Array<Record<string, unknown>>,
  )
}

async function loadShard(baselineId: string): Promise<void> {
  status.value = 'loading'
  try {
    const payload = await getSearchShard(baselineId)
    if (!payload) throw new Error(`没有 ${baselineId} 的索引分片`)
    engine = loadSearchIndex(payload.index) as unknown as MiniSearch<Record<string, unknown>>
    total.value = payload.docCount ?? 0
    status.value = 'ready'
    run()
  } catch (err) {
    // 索引缺失不该让整页崩掉：降级为「引导用导航」，并留下可诊断的日志
    status.value = 'unavailable'
    console.error('[search] 索引装载失败', err)
  }
}

onMounted(() => {
  void loadShard(baseline.value)
})

watch(baseline, (next) => {
  engine = null
  hits.value = []
  void loadShard(next)
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
      <p>{{ t('search.lead', { count: total || '—', baseline: baselineName }) }}</p>
      <p class="pc-hint" style="margin-top: 6px">{{ t('search.scopeNote', { baseline: baselineName }) }}</p>
    </section>

    <div class="pc-panel">
      <!--
        基准切换器**就地换分片**，不复用 BaselineTabs —— 那个走的是
        useBaselineSwitch（切换基准 = 导航到另一个板块），会把用户踢出速查页，
        而这里要的正是「不离开当前页」。
      -->
      <div class="pc-search-scope">
        <span class="pc-hint">{{ t('search.scopeLabel') }}</span>
        <div class="pc-seg" role="radiogroup" :aria-label="t('search.scopeLabel')">
          <button
            v-for="lang in languages.baselineCandidates"
            :key="lang.id"
            type="button"
            role="radio"
            :aria-checked="lang.id === baseline"
            :class="{ 'is-on': lang.id === baseline }"
            @click="pickBaseline(lang.id)"
          >
            {{ lang.shortName }}
          </button>
        </div>
      </div>

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

<style scoped>
.pc-search-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

/*
 * 选中态。`.pc-seg` 的全局规则只认 `aria-pressed='true'`（顶栏那两个开关用的是
 * 它），这里按 radiogroup 语义用的是 `aria-checked`，所以自带一条 —— 而不是
 * 为了让样式生效去改 ARIA 语义（单选组用 aria-checked 才是对的）。
 */
.pc-seg button.is-on {
  background: var(--pc-accent);
  color: #fff;
  font-weight: 600;
}
</style>
