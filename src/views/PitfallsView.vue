<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import CompareLanguageBar from '@/components/compare/CompareLanguageBar.vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { manifest, sectionDefOf } from '@/content/repository'
import { sectionOfRoute } from '@/router'
import { usePairPayload } from '@/composables/usePairPayload'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const languages = useLanguageStore()
const content = useContentStore()
const { t } = useI18n()

const baselineId = computed(() => String(route.params.baseline ?? ''))
const section = computed(() => sectionOfRoute(route))
/** 板块名取自注册表，不走 i18n 里按板块写死的那组 key */
const sectionTitle = computed(() =>
  section.value ? (sectionDefOf(section.value)?.title ?? '') : '',
)
/** 目标不进 URL —— 由页内的对比语言选择条决定（见 stores/language.ts 的 pairTarget） */
const targetId = computed(() => languages.pairTarget ?? '')
const baselineName = computed(() => getLanguageMeta(baselineId.value)?.name ?? baselineId.value)
const targetName = computed(() => getLanguageMeta(targetId.value)?.name ?? targetId.value)

/**
 * 陷阱是**逐对**撰写的：同一门语言，从 JS 出发和从 Python 出发会踩的坑不同。
 * 所以这一页只读一个 (基准, 目标) 对的分片，不再做「目标语言」筛选 ——
 * 目标是 URL 的一部分，筛选项在左侧菜单里。
 */
const { payload, loading } = usePairPayload(baselineId, targetId)
const all = computed(() => payload.value?.pitfalls ?? [])

const query = ref('')
const onlyBaseline = ref(false)
const minSeverity = ref(1)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return all.value.filter((p) => {
    if (onlyBaseline.value && !p.fromBaseline) return false
    if (p.severity < minSeverity.value) return false
    if (!q) return true
    const haystack = [p.title, p.symptomHtml, p.causeHtml, p.fixHtml, p.tags.join(' ')]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

function featureTitle(id?: string): string | undefined {
  return id ? manifest.featureIndex[id]?.title : undefined
}

usePageMeta(
  () => `${baselineName.value} → ${targetName.value} · ${sectionTitle.value}`,
  () =>
    `带着 ${baselineName.value} 的习惯写 ${targetName.value} 会踩的坑：症状、原因、解法与严重度标注。`,
)
</script>

<template>
  <div>
    <PageCrumb
      :items="[
        { label: t('nav.home'), to: '/' },
        { label: t('nav.compare') },
        { label: sectionTitle },
      ]"
    />

    <section class="pc-page-head">
      <h1>{{ baselineName }} → {{ targetName }} · {{ sectionTitle }}</h1>
      <p>
        按<strong>症状</strong>索引，而不是按语法点 —— 迁移时你先感受到的是「结果不对」，而不是「我用错了哪个语法」。
      </p>
      <p class="pc-hint" style="margin-top: 8px">
        {{ t('pitfalls.referenceNote', { baseline: baselineName, target: targetName }) }}
      </p>
    </section>

    <!-- 陷阱是逐方向撰写的，一次只看一个方向。板块从路由读，不写死 ——
         复制本视图去做新列表板块时，不会再漏改这个 id -->
    <CompareLanguageBar v-if="section" :section="section" />

    <div class="pc-toolbar">
      <input
        v-model="query"
        type="search"
        placeholder="搜索症状 / 原因 / 关键词，例如「空数组」「除以零」"
        aria-label="搜索迁移陷阱"
        style="
          flex: 1;
          min-width: 240px;
          padding: 6px 10px;
          border: 1px solid var(--pc-border);
          border-radius: var(--pc-radius);
          background: var(--pc-bg-soft);
        "
      />
      <label class="pc-hint" style="display: inline-flex; gap: 5px; align-items: center">
        <input v-model="onlyBaseline" type="checkbox" />
        {{ t('pitfalls.fromReference', { baseline: baselineName }) }}
      </label>
      <label class="pc-hint" style="display: inline-flex; gap: 5px; align-items: center">
        最低严重度
        <select v-model.number="minSeverity">
          <option :value="1">★</option>
          <option :value="2">★★</option>
          <option :value="3">★★★</option>
        </select>
      </label>
      <span v-if="payload" class="pc-hint">命中 {{ filtered.length }} / {{ all.length }} 条</span>
    </div>

    <!--
      三态必须分开：`payload` 为 null 有两种含义 —— 正在下载、或这个方向确实没写内容。
      合成一个空态会让换方向时闪出一句「暂无内容」，用户读到的结论是错的。
    -->
    <p v-if="content.error" class="pc-empty">
      {{ t('loadFailed') }}
      <span class="pc-hint" style="display: block; margin-top: 8px">{{ content.error }}</span>
    </p>
    <p v-else-if="loading || !payload" class="pc-empty">{{ t('loading') }}</p>
    <template v-else>
      <div class="pc-grid-cards">
        <PitfallCard
          v-for="p in filtered"
          :key="p.id"
          :pitfall="p"
          :baseline-name="baselineName"
          :feature-title="featureTitle(p.featureId)"
        />
      </div>
      <div v-if="!filtered.length" class="pc-empty">{{ t('empty') }}</div>
    </template>
  </div>
</template>
