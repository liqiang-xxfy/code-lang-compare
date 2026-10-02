<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CodeBlock from '@/components/code/CodeBlock.vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import EquivalenceBaselineNote from '@/components/compare/EquivalenceBaselineNote.vue'
import MarkdownContent from '@/components/content/MarkdownContent.vue'
import PitfallCard from '@/components/content/PitfallCard.vue'
import PageCrumb from '@/components/ui/PageCrumb.vue'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { pickColumns } from '@/composables/useVisibleColumns'
import { getCachedBlockDiffs, getCachedDiff } from '@/content/diff'
import { chapterPathOf, manifest, sectionDefOf } from '@/content/repository'
import { useContentStore } from '@/stores/content'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'
import type { LanguageMeta } from '@/schemas'

const route = useRoute()
const content = useContentStore()
const languages = useLanguageStore()
const ui = useUiStore()
const { t } = useI18n()

const featureId = computed(() => `${String(route.params.topicId ?? '')}/${String(route.params.slug ?? '')}`)
const feature = computed(() => content.getFeatureRaw(featureId.value))
const info = computed(() => manifest.featureIndex[featureId.value])

/**
 * 本页的参照系是**本 topic 的基准**，不是 store 里「上次浏览的基准」。
 *
 * 这一点此前是错的：`languages.baseline` 会落到 localStorage 的「上次选择」上，
 * 于是从「以 Python 为基准」的那套内容点进特性页时，只要上次看的是 JS，
 * 列、diff 与徽章就全按 JS 渲染 —— 页面在讲一套内容，却拿另一套当参照系，
 * 而地址（`/feature/<topicId>/<slug>`）里根本看不出这件事。
 */
const topicCfg = computed(() => {
  const id = info.value?.topicId
  return id ? (manifest.topics.find((t) => t.id === id) ?? null) : null
})
const featureBaseline = computed(() => topicCfg.value?.baseline ?? languages.effectiveBaseline)

/**
 * 列顺序：基准恒在最左；对级 topic 锁 `[基准, 目标]`，基准级 topic 跟随运行时勾选。
 * 与章节页同一条规则再过一遍 `pickColumns`（裁到本特性真有实现的语言，基准列恒保留）。
 */
const columns = computed(() => {
  const base = featureBaseline.value
  const cfg = topicCfg.value
  const others = cfg?.target ? [cfg.target] : languages.compareMeta.map((m) => m.id)
  const ordered = [base, ...others.filter((id) => id !== base)]
    .map((id) => languages.metaOf(id))
    .filter((m): m is LanguageMeta => Boolean(m))
  return pickColumns(ordered, base, new Set(Object.keys(feature.value?.snippets ?? {})))
})

const baselineName = computed(
  () => languages.metaOf(featureBaseline.value)?.name ?? featureBaseline.value,
)

/**
 * 只读的方向标识。
 *
 * 该页路由参数里只有 topicId 与 slug，基准是隐含的 —— 这是用户唯一能确认
 * 「这一页在讲谁」的地方。刻意不给可切换的语言条：切基准意味着跳到**另一个
 * topicId** 的地址，而那个 topic 未必有同一个 slug，做一个会失败的控件更糟。
 */
const direction = computed(() => {
  const base = featureBaseline.value
  if (!base) return null
  /*
   * 「对照谁」取**实际显示的列**，而不是本 topic 的覆盖范围 ——
   * 后者会把没勾选、屏幕上根本没有的语言也列出来（覆盖 4 门、只显示 1 门时
   * 那句话是假的）。覆盖范围另有 scopeHint 负责说明。
   */
  return {
    baseName: languages.metaOf(base)?.name ?? base,
    otherNames: columns.value.filter((m) => m.id !== base).map((m) => m.name),
  }
})

/**
 * 相关陷阱来自**本 feature 所属 topic 的那个 (基准, 目标) 对** ——
 * 陷阱现在是逐对的，全站清单不再存在。分片由路由守卫预先加载（见 guards.ts）。
 */
const relatedPitfalls = computed(() => {
  const topicId = info.value?.topicId
  const cfg = manifest.topics.find((x) => x.id === topicId)
  if (!cfg?.target) return []
  const payload = content.getPairRaw(cfg.baseline, cfg.target)
  return (payload?.pitfalls ?? []).filter((p) => p.featureId === featureId.value)
})

/** 面包屑回跳：特性页归属的章节地址由 topic 的三轴字段决定 */
const chapterPath = computed(() => (info.value ? chapterPathOf(info.value.chapterId) : '/'))

/** 面包屑中间一级显示**章节标题**，而不是原始 chapterId —— 后者是内部标识，读不出信息 */
const chapterInfo = computed(() => {
  const id = info.value?.chapterId
  if (!id) return null
  for (const topic of manifest.topics) {
    const hit = topic.chapters.find((c) => c.id === id)
    if (hit) return hit
  }
  return null
})

const crumbs = computed(() => {
  const items: Array<{ label: string; to?: string }> = [{ label: t('nav.home'), to: '/' }]
  const def = topicCfg.value ? sectionDefOf(topicCfg.value.section) : undefined
  if (def) items.push({ label: def.title })
  if (chapterInfo.value) items.push({ label: chapterInfo.value.title, to: chapterPath.value })
  items.push({ label: feature.value?.title ?? '' })
  return items
})

/**
 * 迁移教程的小节 → 概念详解的软引用（refFeatureId）。
 *
 * 迁移模块写自己的 snippet（视角不同、代码更聚焦），不复用 basics 的 feature
 * —— R8 强制 featureId 唯一且归属单一 chapter。这个链接让两边互相可达，
 * 把「两份对照代码各说各话」变成可点达的关系。
 */
const refFeature = computed(() => {
  const id = feature.value?.refFeatureId
  return id ? manifest.featureIndex[id] : undefined
})

/**
 * 基准差异模式下给非基准列计算行级 diff（运行时算 + 缓存）。
 *
 * 返回值与 `snippet.blocks` 按下标对齐，单段内容恒为长度 1 —— 多段必须逐段算，
 * 每段各有自己的行号空间。
 */
function diffsFor(langId: string) {
  if (ui.viewMode !== 'baseline-diff' || langId === featureBaseline.value) return null
  const base = feature.value?.snippets[featureBaseline.value]
  const target = feature.value?.snippets[langId]
  if (!base || !target) return null
  const key = `${featureId.value}|${featureBaseline.value}|${langId}`

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
  const base = feature.value?.snippets[featureBaseline.value]
  const target = feature.value?.snippets[langId]
  return Boolean(
    base?.blocks?.length && target?.blocks?.length && base.blocks.length !== target.blocks.length,
  )
}

usePageMeta(
  () => (feature.value ? `${feature.value.title} 的跨语言对照` : undefined),
  () =>
    feature.value
      ? `${feature.value.title}：在 ${baselineName.value} 与其它语言中的写法、差异与迁移陷阱。${feature.value.summary ?? ''}`
      : undefined,
)
</script>

<template>
  <div v-if="feature">
    <PageCrumb :items="crumbs" />

    <section class="pc-page-head">
      <h1>{{ feature.title }}</h1>
      <!-- 地址里没有基准，这一行是用户唯一能确认「本页在讲谁、拿谁当参照系」的地方 -->
      <p v-if="direction" class="pc-hint" style="margin: 4px 0 0">
        {{ t('compare.baselineLabel', { name: direction.baseName }) }}
        <template v-if="direction.otherNames.length">
          · {{ t('compare.targetLabel', { name: direction.otherNames.join('、') }) }}
        </template>
      </p>
      <div class="pc-feature-meta" style="margin: 6px 0">
        <span class="pc-tag">{{ feature.kind }}</span>
        <!-- 同两个布局：排除基准（基准相对自己恒为 =，是废话），并标出语言短名 -->
        <EquivalenceBadge
          v-for="s in Object.values(feature.snippets).filter(
            (s) => s.lang !== featureBaseline,
          )"
          :key="s.lang"
          :value="s.equivalence"
          :lang-name="languages.metaOf(s.lang)?.shortName"
        />
      </div>
      <p v-if="feature.summary">{{ feature.summary }}</p>
      <p v-if="refFeature" class="pc-hint" style="margin-top: 6px">
        概念详解：
        <RouterLink :to="`/feature/${feature.refFeatureId}`">{{ refFeature.title }} →</RouterLink>
      </p>
    </section>

    <MarkdownContent v-if="feature.bodyHtml" :html="feature.bodyHtml" class="pc-panel" style="margin-bottom: 18px" />

    <EquivalenceBaselineNote />

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
            v-if="feature.snippets[lang.id]"
            :snippet="feature.snippets[lang.id]!"
            :lang-meta="lang"
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
          :feature-title="feature.title"
        />
      </div>
    </section>
  </div>

  <!-- 装载失败与「还在加载」必须分开：此前 ensureChapter 没有 catch，失败会永远停在加载中 -->
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
