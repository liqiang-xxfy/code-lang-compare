<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { usePersistedState } from '@/composables/usePersistedState'
import { getRoadmap } from '@/content/repository'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const { t } = useI18n()

const langId = computed(() => String(route.params.langId ?? ''))
const lang = computed(() => getLanguageMeta(langId.value))
const stages = computed(() => getRoadmap(langId.value))

/** 勾选状态按语言分别持久化（pc:v1:progress:<lang>） */
const progress = usePersistedState<Record<string, boolean>>(
  `progress:${langId.value}`,
  {},
)

const doneCount = computed(
  () => stages.value.flatMap((s) => s.acceptance).filter((a) => progress.value[`${a}`]).length,
)
const totalCount = computed(() => stages.value.flatMap((s) => s.acceptance).length)

function toggle(key: string): void {
  progress.value = { ...progress.value, [key]: !progress.value[key] }
}

usePageMeta(
  () => (lang.value ? `JS → ${lang.value.name} 学习路线` : undefined),
  () =>
    lang.value
      ? `从 JavaScript 迁移到 ${lang.value.name} 的分阶段路线：每阶段的目标、时长与验收标准。`
      : undefined,
)
</script>

<template>
  <div v-if="lang">
    <section class="pc-page-head">
      <h1>JS → {{ lang.name }} 学习路线</h1>
      <p>
        {{ stages.length }} 个阶段，共 {{ totalCount }} 条验收标准。
        <span v-if="totalCount">已完成 {{ doneCount }} / {{ totalCount }}（存在本地，不上传）。</span>
      </p>
    </section>

    <article v-for="stage in stages" :key="stage.id" class="pc-panel" style="margin-bottom: 14px">
      <h2 style="font-size: var(--pc-fs-lg)">
        {{ stage.order }}. {{ stage.title }}
        <span v-if="stage.durationHint" class="pc-tag" style="margin-left: 6px">
          {{ stage.durationHint }}
        </span>
      </h2>

      <h3 style="font-size: var(--pc-fs-sm); margin: 10px 0 4px; color: var(--pc-text-mute)">
        做什么
      </h3>
      <ul class="pc-checklist">
        <li v-for="todo in stage.todo" :key="todo">
          <span aria-hidden="true">·</span><span>{{ todo }}</span>
        </li>
      </ul>

      <h3 style="font-size: var(--pc-fs-sm); margin: 10px 0 4px; color: var(--pc-text-mute)">
        验收标准
      </h3>
      <ul class="pc-checklist">
        <li v-for="item in stage.acceptance" :key="item">
          <input
            type="checkbox"
            :checked="Boolean(progress[item])"
            :id="`acc-${stage.id}-${item}`"
            @change="toggle(item)"
          />
          <label :for="`acc-${stage.id}-${item}`">{{ item }}</label>
        </li>
      </ul>

      <p v-if="stage.resources.length" class="pc-hint" style="margin-bottom: 0; margin-top: 10px">
        资源：
        <span v-for="(r, i) in stage.resources" :key="r.url">
          <span v-if="i"> · </span>
          <a :href="r.url" target="_blank" rel="noopener noreferrer">{{ r.label }}</a>
        </span>
      </p>
    </article>

    <div v-if="!stages.length" class="pc-empty">
      这门语言的路线图尚未编写（{{ t('empty') }}）。
    </div>
  </div>

  <div v-else class="pc-empty">{{ t('empty') }}</div>
</template>
