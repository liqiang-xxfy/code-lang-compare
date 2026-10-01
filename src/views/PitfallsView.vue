<script setup lang="ts">
import { computed, ref } from 'vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getPitfalls, manifest } from '@/content/repository'

const { t } = useI18n()
const query = ref('')
const onlyBaseline = ref(false)
const minSeverity = ref(1)

const all = getPitfalls()

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return all.filter((p) => {
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
  () => t('nav.pitfalls'),
  () => '按症状检索的跨语言迁移陷阱清单：症状、原因、解法与严重度标注。',
)
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ t('nav.pitfalls') }}</h1>
      <p>
        按<strong>症状</strong>索引，而不是按语法点 —— 迁移时你先感受到的是「结果不对」，而不是「我用错了哪个语法」。
      </p>
    </section>

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
        只看「JS 开发者必踩」
      </label>
      <label class="pc-hint" style="display: inline-flex; gap: 5px; align-items: center">
        最低严重度
        <select v-model.number="minSeverity">
          <option :value="1">★</option>
          <option :value="2">★★</option>
          <option :value="3">★★★</option>
        </select>
      </label>
      <span class="pc-hint">命中 {{ filtered.length }} / {{ all.length }} 条</span>
    </div>

    <div class="pc-grid-cards">
      <PitfallCard
        v-for="p in filtered"
        :key="p.id"
        :pitfall="p"
        :feature-title="featureTitle(p.featureId)"
      />
    </div>

    <div v-if="!filtered.length" class="pc-empty">{{ t('empty') }}</div>
  </div>
</template>
