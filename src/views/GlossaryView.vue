<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getGlossary } from '@/content/repository'
import { enabledLanguageIds, getLanguageMeta } from '@/generated/registry.gen'

const { t } = useI18n()
const query = ref('')

const terms = getGlossary()
const columns = enabledLanguageIds

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return terms
  return terms.filter((item) =>
    [item.term, item.aliases.join(' '), Object.values(item.perLanguage).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
})

usePageMeta(
  () => t('nav.glossary'),
  () => '同名不同义 / 异名同义的跨语言术语对照：对象、接口、模块、装饰器、迭代器……',
)
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ t('nav.glossary') }}</h1>
      <p>
        迁移时最容易被「看起来一样的词」骗到。<code>interface</code>、<code>module</code>、
        <code>@decorator</code> 在三门语言里长得一样，含义却可能完全不同。
      </p>
    </section>

    <div class="pc-toolbar">
      <input
        v-model="query"
        type="search"
        placeholder="搜索术语"
        aria-label="搜索术语"
        style="
          flex: 1;
          min-width: 240px;
          padding: 6px 10px;
          border: 1px solid var(--pc-border);
          border-radius: var(--pc-radius);
          background: var(--pc-bg-soft);
        "
      />
      <span class="pc-hint">{{ filtered.length }} 条</span>
    </div>

    <div
      v-for="item in filtered"
      :id="`term-${encodeURIComponent(item.term)}`"
      :key="item.term"
      class="pc-panel"
      style="margin-bottom: 12px"
    >
      <h2 style="font-size: var(--pc-fs-lg)">
        {{ item.term }}
        <span v-for="a in item.aliases" :key="a" class="pc-tag" style="margin-left: 6px">{{ a }}</span>
      </h2>
      <table class="pc-table-simple" style="margin-top: 8px">
        <thead>
          <tr>
            <th>语言</th>
            <th>在该语言里的含义 / 叫法</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="id in columns" :key="id">
            <th scope="row">{{ getLanguageMeta(id)?.name ?? id }}</th>
            <td>{{ item.perLanguage[id] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="item.note" class="pc-hint" style="margin-bottom: 0; margin-top: 8px">
        ⚠ {{ item.note }}
      </p>
    </div>

    <div v-if="!filtered.length" class="pc-empty">{{ t('empty') }}</div>
  </div>
</template>
