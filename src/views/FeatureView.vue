<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import EquivalenceBaselineNote from '@/components/compare/EquivalenceBaselineNote.vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { badgeOf, explanationOf } from '@/content/boxView'
import { getCachedBlockDiffs, getCachedDiff } from '@/content/diff'
import {
  catalogOf,
  chapterOf,
  chapterPathOf,
  featureMetaOf,
  hasBoxChapter,
  orderedSections,
  pairTargetsOf,
  sectionDefOf,
  featurePathOf,
} from '@/content/repository'
import { defaultCompareLanguageId } from '@/generated/registry.gen'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'
import type { LanguageMeta } from '@/schemas'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const ui = useUiStore()
const { t } = useI18n()

/** 全局 feature id = `<板块>/<章节>/<feature>`，正好是路由的三段 */
const gid = computed(
  () =>
    `${String(route.params.section ?? '')}/${String(route.params.chapter ?? '')}/${String(
      route.params.feature ?? '',
    )}`,
)
const meta = computed(() => featureMetaOf(gid.value))
const catalogFeature = computed(() => {
  const m = meta.value
  if (!m) return null
  return catalogOf(m.section)?.chapters.find((c) => c.id === m.chapter)?.features.find((f) => f.id === route.params.feature) ?? null
})

/**
 * 本页的参照系 = **当前基准**。
 *
 * v2 的 feature 与语言无关（清单是语言无关的），所以「拿谁当参照系」只由
 * 用户的基准选择决定，不再由内容自己携带（v1 的 topic.baseline 已消失）。
 */
const featureBaseline = computed(() => languages.effectiveBaseline)

/**
 * 列顺序：基准恒在最左，其余跟随运行时勾选；再裁到**本特性真有 box 的语言**
 * （判据是该语言在这一章有分片 —— 与章节页同源）。
 */
const columns = computed(() => {
  const m = meta.value
  if (!m) return [] as LanguageMeta[]
  const base = featureBaseline.value
  const ordered = [
    base,
    ...languages.compareMeta.map((x) => x.id).filter((id) => id !== base),
  ]
    .map((id) => languages.metaOf(id))
    .filter((x): x is LanguageMeta => Boolean(x))
  return ordered.filter(
    (x) => x.id === base || hasBoxChapter(x.id, m.section, m.chapter),
  )
})

/** 各列的 box（同一章分片里按 feature 取） */
const boxOf = (langId: string) => {
  const m = meta.value
  if (!m) return undefined
  return content.getBoxChapterRaw(langId, m.section, m.chapter)?.boxes[route.params.feature as string]
}

/** 按需加载可见列的分片 —— 勾选变化不产生导航，必须靠 watcher */
watch(
  columns,
  (cols) => {
    const m = meta.value
    if (!m || !cols.length) return
    void content.ensureColumns(m.section, m.chapter, cols.map((x) => x.id))
  },
  { immediate: true },
)

const baselineName = computed(() => languages.metaOf(featureBaseline.value)?.name ?? featureBaseline.value)

/**
 * 承载「相关迁移陷阱」的板块 —— 按 `dataKey` 从注册表定位，不写死板块名。
 *
 * 这件事本身就锚在「陷阱」这个概念上（「这个知识点在别处踩过什么坑」），
 * 与首页那个区块是同一种耦合，所以同样声明在 `verify:sections` 的白名单里。
 */
const pitfallSection = orderedSections().find((s) => s.dataKey === 'pitfalls')?.id ?? null

/**
 * 相关陷阱：(基准, 目标) 对是**运行时推导**的 —— v2 的 feature 不属于任何方向。
 * 取用户最近挑的方向，否则默认对比语言，否则该基准下第一个有陷阱的方向。
 */
const pitfallTarget = computed(() => {
  const base = featureBaseline.value
  if (!pitfallSection) return null
  const available = pairTargetsOf(base, pitfallSection)
  if (!available.length) return null
  const pref = languages.preferredTarget
  if (pref && available.includes(pref)) return pref
  return available.includes(defaultCompareLanguageId) ? defaultCompareLanguageId : available[0]!
})

watch(
  [pitfallTarget, featureBaseline],
  ([target, base]) => {
    if (target) void content.ensurePair(base, target)
  },
  { immediate: true },
)

const relatedPitfalls = computed(() => {
  const target = pitfallTarget.value
  if (!target) return []
  const payload = content.getPairRaw(featureBaseline.value, target)
  return (payload?.pitfalls ?? []).filter((p) => p.featureId === gid.value)
})

const crumbs = computed(() => {
  const items: Array<{ label: string; to?: string }> = [{ label: t('nav.home'), to: '/' }]
  const m = meta.value
  if (m) {
    items.push({ label: sectionDefOf(m.section)?.title ?? '' })
    const ch = chapterOf(m.section, m.chapter)
    if (ch) {
      items.push({
        label: ch.title,
        to: chapterPathOf(featureBaseline.value, m.section, m.chapter),
      })
    }
  }
  items.push({ label: catalogFeature.value?.title ?? gid.value })
  return items
})

/**
 * 基准差异模式下给非基准列计算行级 diff（运行时算 + 缓存）。
 * 返回值与 `box.blocks` 按下标对齐，单段内容恒为长度 1。
 */
function diffsFor(langId: string) {
  if (ui.viewMode !== 'baseline-diff' || langId === featureBaseline.value) return null
  const base = boxOf(featureBaseline.value)
  const target = boxOf(langId)
  if (!base || !target) return null
  const key = `${gid.value}|${featureBaseline.value}|${langId}`

  const baseBlocks = base.blocks?.map((b) => b.code)
  const targetBlocks = target.blocks?.map((b) => b.code)
  if (baseBlocks?.length && targetBlocks?.length) {
    return getCachedBlockDiffs(key, baseBlocks, targetBlocks)
  }
  if (!base.code || !target.code) return null
  return [getCachedDiff(key, base.code, target.code)]
}

/** 两侧都是多段、但段数不同 —— 无法逐段对齐 */
function blocksMismatch(langId: string): boolean {
  if (ui.viewMode !== 'baseline-diff' || langId === featureBaseline.value) return false
  const base = boxOf(featureBaseline.value)
  const target = boxOf(langId)
  return Boolean(
    base?.blocks?.length && target?.blocks?.length && base.blocks.length !== target.blocks.length,
  )
}

usePageMeta(
  () => (catalogFeature.value ? `${catalogFeature.value.title} 的跨语言对照` : undefined),
  () =>
    catalogFeature.value
      ? `${catalogFeature.value.title}：在 ${baselineName.value} 与其它语言中的写法、差异与迁移陷阱。${catalogFeature.value.summary ?? ''}`
      : undefined,
)
</script>

<template>
  <div v-if="catalogFeature && meta">
    <PageCrumb :items="crumbs" />

    <section class="pc-page-head">
      <h1>{{ catalogFeature.title }}</h1>
      <!-- 地址里没有基准，这一行是用户唯一能确认「本页在拿谁当参照系」的地方 -->
      <p class="pc-hint" style="margin: 4px 0 0">
        {{ t('compare.baselineLabel', { name: baselineName }) }}
        <template v-if="columns.filter((x) => x.id !== featureBaseline).length">
          ·
          {{
            t('compare.targetLabel', {
              name: columns
                .filter((x) => x.id !== featureBaseline)
                .map((x) => x.name)
                .join('、'),
            })
          }}
        </template>
      </p>
      <div class="pc-feature-meta" style="margin: 6px 0">
        <span class="pc-tag">{{ catalogFeature.kind }}</span>
        <!-- 排除基准（基准相对自己恒为 =，是废话），并标出语言短名 -->
        <template v-for="lang in columns" :key="lang.id">
          <EquivalenceBadge
            v-if="boxOf(lang.id) && badgeOf(boxOf(lang.id)!, lang.id, featureBaseline)"
            :value="badgeOf(boxOf(lang.id)!, lang.id, featureBaseline)!"
            :lang-name="lang.shortName"
          />
        </template>
      </div>
      <p v-if="catalogFeature.summary">{{ catalogFeature.summary }}</p>
      <p v-if="catalogFeature.refFeatureId" class="pc-hint" style="margin-top: 6px">
        概念详解：
        <RouterLink :to="featurePathOf(catalogFeature.refFeatureId)">查看 →</RouterLink>
      </p>
    </section>

    <EquivalenceBaselineNote :baseline="featureBaseline" />

    <div class="pc-cards">
      <article
        v-for="lang in columns"
        :key="lang.id"
        class="pc-card"
        :class="{ 'is-baseline': lang.id === featureBaseline }"
      >
        <div class="pc-card-head">
          <strong>{{ lang.name }}</strong>
          <span class="pc-hint">{{ lang.fileExtension }}</span>
          <span v-if="lang.id === featureBaseline" class="pc-tag">{{ t('baseline.label') }}</span>
        </div>
        <div class="pc-card-body">
          <CodeBlock
            v-if="boxOf(lang.id)"
            :box="boxOf(lang.id)!"
            :lang-meta="lang"
            :explanation-html="explanationOf(boxOf(lang.id)!, lang.id, featureBaseline)"
            :equivalence="badgeOf(boxOf(lang.id)!, lang.id, featureBaseline)"
            :diffs="diffsFor(lang.id)"
            :blocks-mismatch="blocksMismatch(lang.id)"
            :is-baseline="lang.id === featureBaseline"
            show-line-numbers
          />
          <p v-else class="pc-hint">{{ t('emptyCell') }}</p>
        </div>
      </article>
    </div>

    <section v-if="relatedPitfalls.length" style="margin-top: 24px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">相关迁移陷阱</h2>
      <div class="pc-grid-cards">
        <PitfallCard
          v-for="p in relatedPitfalls"
          :key="p.id"
          :pitfall="p"
          :baseline-name="baselineName"
          :feature-title="catalogFeature.title"
        />
      </div>
    </section>
  </div>

  <!-- 装载失败与「还在加载」必须分开 -->
  <p v-else-if="content.error" class="pc-empty">
    {{ t('loadFailed') }}
    <span class="pc-hint" style="display: block; margin-top: 8px">{{ content.error }}</span>
  </p>
  <div v-else class="pc-empty">{{ t('loading') }}</div>
</template>

<style scoped>
.pc-card.is-baseline {
  border-color: var(--pc-accent);
}
</style>
