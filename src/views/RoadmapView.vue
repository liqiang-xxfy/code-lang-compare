<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import CompareLanguageBar from '@/components/compare/CompareLanguageBar.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { sectionDefOf } from '@/content/repository'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { usePersistedState } from '@/composables/usePersistedState'
import { usePairPayload } from '@/composables/usePairPayload'
import { sectionOfRoute } from '@/router'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { getLanguageMeta } from '@/generated/registry.gen'

const route = useRoute()
const languages = useLanguageStore()
const content = useContentStore()
const { t } = useI18n()

const section = computed(() => sectionOfRoute(route))
const sectionTitle = computed(() =>
  section.value ? (sectionDefOf(section.value)?.title ?? '') : '',
)
const baselineId = computed(() => String(route.params.baseline ?? ''))
const targetId = computed(() => languages.pairTarget ?? '')
const baselineName = computed(() => getLanguageMeta(baselineId.value)?.name ?? baselineId.value)
const targetName = computed(() => getLanguageMeta(targetId.value)?.name ?? targetId.value)

/**
 * 路线图是**逐对**的：从 Java 迁到 Python 与从 Python 迁到 Java 是两条不同的路线。
 * 出发端因此来自 URL 的基准，而不是某个全局常量。
 */
const { payload, loading } = usePairPayload(baselineId, targetId)
const stages = computed(() => payload.value?.roadmaps ?? [])

/**
 * 勾选状态的持久化（`pc:v1:progressByDirection`）。
 *
 * 这里修掉了两个 bug：
 *
 *  1. **条的 key 曾是验收文本本身** —— 内容里改一个错字，用户的勾选就全部对不上，
 *     进度静默清零。改成 `stage.id#序号`：`id` 在 roadmap schema 里是必填且稳定的。
 *  2. **存储 key 曾把 `(基准, 目标)` 拼进去** —— 而 `usePersistedState` 的 key 是
 *     setup 时求值一次的，页内换方向**不发生导航、组件不重挂**，于是所有方向
 *     共用同一个 key，切一次方向就读到另一个方向的勾选。改成「一个固定 key +
 *     内层按方向分桶」，方向成为数据而不是 key 的一部分。
 *
 * 旧 key（`progress:<基准>--<目标>`）就此作废，**不做迁移** —— 见 ADR-17：
 * 单用户工具，迁移代码的成本大于收益。旧值留在 localStorage 里无人读取。
 */
const progress = usePersistedState<Record<string, Record<string, boolean>>>(
  'progressByDirection',
  {},
)

const directionKey = computed(() => `${baselineId.value}--${targetId.value}`)
const checks = computed(() => progress.value[directionKey.value] ?? {})

/** 验收条的稳定 key —— 与文案无关，改文案不会丢进度 */
const itemKey = (stageId: string, index: number): string => `${stageId}#${index}`

const doneCount = computed(() =>
  stages.value.reduce(
    (n, s) => n + s.acceptance.filter((_, i) => checks.value[itemKey(s.id, i)]).length,
    0,
  ),
)
const totalCount = computed(() => stages.value.flatMap((s) => s.acceptance).length)

function toggle(key: string): void {
  const dir = directionKey.value
  const current = checks.value
  progress.value = { ...progress.value, [dir]: { ...current, [key]: !current[key] } }
}

usePageMeta(
  () => `${baselineName.value} → ${targetName.value} · ${sectionTitle.value}`,
  () =>
    `从 ${baselineName.value} 迁移到 ${targetName.value} 的分阶段路线：每阶段的目标、时长与验收标准。`,
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
      <p v-if="payload">
        {{ stages.length }} 个阶段，共 {{ totalCount }} 条验收标准。
        <span v-if="totalCount">已完成 {{ doneCount }} / {{ totalCount }}（存在本地，不上传）。</span>
      </p>
    </section>

    <!-- 路线图是逐方向撰写的，一次只看一个方向 -->
    <CompareLanguageBar v-if="section" :section="section" />

    <!-- 装载中与「这个方向还没写路线」都是 null，必须分开（见 PitfallsView 的同类说明） -->
    <p v-if="content.error" class="pc-empty">
      {{ t('loadFailed') }}
      <span class="pc-hint" style="display: block; margin-top: 8px">{{ content.error }}</span>
    </p>
    <p v-else-if="loading || !payload" class="pc-empty">{{ t('loading') }}</p>

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
        <li v-for="(item, i) in stage.acceptance" :key="itemKey(stage.id, i)">
          <input
            type="checkbox"
            :checked="Boolean(checks[itemKey(stage.id, i)])"
            :id="`acc-${stage.id}-${i}`"
            @change="toggle(itemKey(stage.id, i))"
          />
          <label :for="`acc-${stage.id}-${i}`">{{ item }}</label>
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

    <div v-if="!loading && payload && !stages.length" class="pc-empty">
      这个方向的路线图尚未编写（{{ t('empty') }}）。
    </div>
  </div>
</template>
