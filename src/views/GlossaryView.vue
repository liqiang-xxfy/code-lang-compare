<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import CompareLanguageBar from '@/components/compare/CompareLanguageBar.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { sectionDefOf } from '@/content/repository'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { usePairPayload } from '@/composables/usePairPayload'
import { sectionOfRoute } from '@/router'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const languages = useLanguageStore()
const content = useContentStore()
const { t } = useI18n()
const query = ref('')

const section = computed(() => sectionOfRoute(route))
const sectionTitle = computed(() =>
  section.value ? (sectionDefOf(section.value)?.title ?? '') : '',
)
const baselineId = computed(() => String(route.params.baseline ?? ''))
const targetId = computed(() => languages.pairTarget ?? '')
const baselineName = computed(() => getLanguageMeta(baselineId.value)?.name ?? baselineId.value)
const targetName = computed(() => getLanguageMeta(targetId.value)?.name ?? targetId.value)

/**
 * 词典也是**逐对**的：一条术语在「从 JS 出发」与「从 Java 出发」下要讲的东西不同，
 * 所以只列本方向的两门语言（R5 会拦第三门）。列不跟多选走。
 */
const { payload, loading } = usePairPayload(baselineId, targetId)
const terms = computed(() => payload.value?.glossary ?? [])
const columns = computed(() => [baselineId.value, targetId.value])

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return terms.value
  return terms.value.filter((item) =>
    [item.term, item.aliases.join(' '), Object.values(item.perLanguage).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
})

usePageMeta(
  () => `${baselineName.value} → ${targetName.value} · ${sectionTitle.value}`,
  () =>
    `从 ${baselineName.value} 出发最容易误解的 ${targetName.value} 术语：同名不同义与异名同义。`,
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
        迁移时最容易被「看起来一样的词」骗到。<code>interface</code>、<code>module</code>、
        <code>@decorator</code> 在不同语言里长得一样，含义却可能完全不同。
      </p>
    </section>

    <!-- 词典是逐方向撰写的，一次只看一个方向 -->
    <CompareLanguageBar v-if="section" :section="section" />

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
      <span v-if="payload" class="pc-hint">{{ filtered.length }} 条</span>
    </div>

    <!-- 装载中与「确实没写内容」都是 null，必须分开（见 PitfallsView 的同类说明） -->
    <p v-if="content.error" class="pc-empty">
      {{ t('loadFailed') }}
      <span class="pc-hint" style="display: block; margin-top: 8px">{{ content.error }}</span>
    </p>
    <p v-else-if="loading || !payload" class="pc-empty">{{ t('loading') }}</p>

    <template v-else>
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
    </template>
  </div>
</template>
