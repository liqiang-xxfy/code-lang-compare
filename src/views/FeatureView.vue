<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { badgeOf, explanationOf } from '@/content/boxView'
import {
  chapterContaining,
  chapterPathOf,
  featureMetaOf,
  featurePathOf,
  hasBoxGroup,
  orderedSections,
  pairTargetsOf,
  sectionDefOf,
} from '@/content/repository'
import { defaultCompareLanguageId } from '@/generated/registry.gen'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import type { LanguageMeta } from '@/schemas'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const { t } = useI18n()

/**
 * 全局 feature id = `<板块>/<feature>`，正好是路由的两段。
 *
 * 详情页**不需要章**：feature 属于池（与基准无关），box 的归属只由存放组决定。
 * 章要等确定了基准才能问 —— 见下面的面包屑。
 */
const gid = computed(
  () => `${String(route.params.section ?? '')}/${String(route.params.feature ?? '')}`,
)
const meta = computed(() => featureMetaOf(gid.value))

/**
 * 本页的参照系 = **当前基准**。
 *
 * v2 的 feature 与语言无关（清单是语言无关的），所以「拿谁当参照系」只由
 * 用户的基准选择决定，不再由内容自己携带（v1 的 topic.baseline 已消失）。
 */
const featureBaseline = computed(() => languages.effectiveBaseline)

/**
 * 列顺序：基准恒在最左，其余跟随运行时勾选；再裁到**这个知识点真有 box 的语言**
 * （判据是它写了这个存放组 —— 与章节页同源）。
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
  return ordered.filter((x) => x.id === base || hasBoxGroup(x.id, m.section, m.group))
})

/** 各列的 box（本知识点的存放组里按 feature 取） */
const boxOf = (langId: string) => {
  const m = meta.value
  if (!m) return undefined
  return content.boxesOf(langId, m.section, [m.group])?.[String(route.params.feature ?? '')]
}

/** 按需加载可见列的分片 —— 勾选变化不产生导航，必须靠 watcher */
watch(
  columns,
  (cols) => {
    const m = meta.value
    if (!m || !cols.length) return
    void content.ensureChapter(m.section, [m.group], cols.map((x) => x.id))
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

/**
 * 面包屑里的章节层是**按当前基准现查的** —— 章节分类每个基准各一份，
 * 这个知识点可能被某个基准取舍掉（那时就没有章节层可指）。
 */
const crumbs = computed(() => {
  const items: Array<{ label: string; to?: string }> = [{ label: t('nav.home'), to: '/' }]
  const m = meta.value
  if (m) {
    items.push({ label: sectionDefOf(m.section)?.title ?? '' })
    const ch = chapterContaining(featureBaseline.value, m.section, String(route.params.feature ?? ''))
    if (ch) {
      items.push({ label: ch.title, to: chapterPathOf(featureBaseline.value, m.section, ch.id) })
    }
  }
  items.push({ label: m?.title ?? gid.value })
  return items
})

usePageMeta(
  () => (meta.value ? `${meta.value.title} 的跨语言对照` : undefined),
  () =>
    meta.value
      ? `${meta.value.title}：在 ${baselineName.value} 与其它语言中的写法、差异与迁移陷阱。${meta.value.summary ?? ''}`
      : undefined,
)
</script>

<template>
  <div v-if="meta">
    <PageCrumb :items="crumbs" />

    <section class="pc-page-head">
      <h1>{{ meta.title }}</h1>
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
        <span class="pc-tag">{{ meta.kind }}</span>
        <!-- 排除基准（基准相对自己恒为 =，是废话），并标出语言短名 -->
        <template v-for="lang in columns" :key="lang.id">
          <EquivalenceBadge
            v-if="boxOf(lang.id) && badgeOf(boxOf(lang.id)!, lang.id, featureBaseline)"
            :value="badgeOf(boxOf(lang.id)!, lang.id, featureBaseline)!"
            :lang-name="lang.shortName"
          />
        </template>
      </div>
      <p v-if="meta.summary">{{ meta.summary }}</p>
      <p v-if="meta.refFeatureId" class="pc-hint" style="margin-top: 6px">
        概念详解：
        <RouterLink :to="featurePathOf(meta.refFeatureId)">查看 →</RouterLink>
      </p>
    </section>

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
          :feature-title="meta.title"
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
