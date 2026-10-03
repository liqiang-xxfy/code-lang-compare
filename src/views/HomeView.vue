<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { usePageMeta } from '@/composables/usePageMeta'
import { manifest, orderedSections, visibleChaptersOf } from '@/content/repository'
import { compareEntryPath, sectionEntryPath } from '@/router'
import { useContentStore } from '@/stores/content'
import {
  baselineLanguageIds,
  defaultBaselineLanguageId,
  defaultCompareLanguageId,
  enabledLanguageIds,
  enabledLanguageMeta,
  getLanguageMeta,
  siteInfo,
} from '@/generated/registry.gen'
import type { Section } from '@/schemas'

const content = useContentStore()
const nameOf = (id: string) => getLanguageMeta(id)?.name ?? id

/**
 * 首页刻意做成**全静态**：所有跳转都锚定构建期常量（默认基准、默认对比语言），
 * 因此预渲染出来的 HTML 与客户端首帧完全一致，不需要「挂载后再读 store」
 * 那种规避 hydration 不匹配的技巧 —— 那正是旧首页被迫付出的复杂度。
 */
const defaultBaselineName = nameOf(defaultBaselineLanguageId)
const defaultCompareName = nameOf(defaultCompareLanguageId)

/**
 * 某个基准在全部章节型板块下**真正能打开**的章节 —— **每个基准一套分类**，所以逐基准算。
 *
 * 走 `visibleChaptersOf` 而不是 `chaptersOf` 是必须的：章节分类先于内容落库
 * （清单一次列全、内容按批填），不过滤的话卡片会写「N 个模块」而点进去 404。
 */
const chaptersFor = (baseline: string) =>
  orderedSections()
    .filter((s) => s.shape === 'chapter')
    .flatMap((s) => visibleChaptersOf(baseline, s.id))

/**
 * 三个基准入口 —— 每个基准有自己的一套地址、**自己的章节分类**与浏览语境。
 * 所以卡片上的「N 个模块」三张可以不同，这正是 S6.5 想要的效果。
 */
const baselineCards = computed(() =>
  baselineLanguageIds.map((id) => {
    const chapters = chaptersFor(id)
    return {
      id,
      name: nameOf(id),
      // 与顶栏、URL 走同一个落点函数，不自己拼地址 —— 首页入口曾因手拼地址全部 404
      to: compareEntryPath(id),
      chapterCount: chapters.length,
      featureCount: chapters.reduce((n, c) => n + c.features.length, 0),
    }
  }),
)

/** 「最该先知道的坑」区块的落点 —— 声明了该 dataKey 的板块 */
const pitfallsEntry = computed(() => {
  const section = orderedSections().find((x) => x.dataKey === 'pitfalls')?.id
  return section ? sectionEntryPath(defaultBaselineLanguageId, section) : '/404'
})

/** 默认基准下的板块入口（按注册表的 order），带各自的内容量 */
const sectionEntries = computed(() => {
  const b = defaultBaselineLanguageId
  /*
   * 计数按板块的 `scope` 分：基准级板块数**该基准分类下的**章节，
   * 对级板块每个方向一份（数方向）。若按 `shape` 分，速查板块会被数成 1。
   */
  const countOf = (section: Section, scope: string) =>
    scope === 'baseline'
      ? visibleChaptersOf(b, section).length
      : manifest.pairs.filter((p) => p.baseline === b && p.sections.includes(section)).length

  return orderedSections().map((def) => ({
    section: def.id,
    label: def.label,
    to: sectionEntryPath(b, def.id),
    count: countOf(def.id, def.scope),
  }))
})

/**
 * 默认基准下最该先看的几条陷阱。
 *
 * 这一段是**客户端补的**：陷阱分片要按需下载，首页本身保持纯静态
 * （SSG 时这里渲染为空，挂载后出现）。放在静态区里会破坏预渲染，
 * 放进 store 读又会让首屏依赖本地偏好 —— 两者都不划算，所以只有这一块例外。
 */
const homePair = manifest.pairs.find(
  (p) => p.baseline === defaultBaselineLanguageId && p.target === defaultCompareLanguageId,
)
const topPitfalls = computed(() =>
  homePair ? (content.getPairRaw(homePair.baseline, homePair.target)?.pitfalls ?? []).slice(0, 3) : [],
)

onMounted(() => {
  if (homePair) void content.ensurePair(homePair.baseline, homePair.target)
})

usePageMeta(
  () => siteInfo.name,
  () => siteInfo.shortDescription,
)
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ siteInfo.name }}</h1>
      <p>{{ siteInfo.shortDescription }}</p>
    </section>

    <section class="pc-panel" style="margin-bottom: 20px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 8px">怎么用</h2>
      <ol class="pc-steps">
        <li>
          <strong>选一门基准语言</strong>——它是参照系，决定你从哪门语言的视角看差异。
          下面三张卡片就是三个基准，默认 {{ defaultBaselineName }}，也可以选
          {{ baselineLanguageIds.filter((x) => x !== defaultBaselineLanguageId).map(nameOf).join(' / ') }}。
          进了对比页之后，页面顶部那条选择条的<strong>第一组</strong>同样可以切，
          每个基准有各自的一套内容与地址，切换会跳到对应的页面。
        </li>
        <li>
          <strong>再选要对照的语言</strong>——每个板块页面顶部都有一条选择条，默认带上
          {{ defaultCompareName }}。基础语法是<strong>多选</strong>，勾几门就并排对照几门；
          迁移教程、陷阱、词典与路线是逐方向撰写的，所以是<strong>单选</strong>，
          换一门语言等于换一篇文章。
        </li>
        <li>
          <strong>沿板块依次看</strong>——{{ sectionEntries.map((e) => e.label).join(' → ') }}。
          左侧菜单就是这几项，展开的二级是各章，每一页都在。
        </li>
      </ol>
    </section>

    <section style="margin-bottom: 22px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">选一个基准开始</h2>
      <div class="pc-grid-cards">
        <!--
          卡片拆成「主链接 + 次级链接」，而不是整块套一个 RouterLink：
          链接里套链接是无效标记，而「了解这门语言」正是 `/lang/:id` 此前
          唯一的入口缺口 —— 它有内容，但全站没有任何链接指向它。
        -->
        <div v-for="card in baselineCards" :key="card.id" class="pc-panel pc-baseline-card">
          <RouterLink :to="card.to" class="pc-baseline-main">
            <h3 style="font-size: var(--pc-fs-lg); margin-bottom: 4px">以 {{ card.name }} 为基准</h3>
            <p class="pc-hint" style="margin: 0">
              {{ card.chapterCount }} 个模块 · {{ card.featureCount }} 个对照点
            </p>
          </RouterLink>
          <RouterLink :to="`/lang/${card.id}`" class="pc-hint pc-baseline-lang">
            了解 {{ card.name }} 这门语言 →
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="pc-panel" style="margin-bottom: 22px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 6px">
        {{ defaultBaselineName }} 基准下的板块
      </h2>
      <p class="pc-hint">点任意一项直接进入对应内容。</p>
      <ul class="pc-tree" style="margin-top: 10px">
        <li v-for="entry in sectionEntries" :key="entry.section" class="pc-entry-row">
          <RouterLink :to="entry.to">{{ entry.label }}</RouterLink>
          <span class="pc-hint">（{{ entry.count }} 项）</span>
        </li>
      </ul>
    </section>

    <section v-if="topPitfalls.length" class="pc-panel" style="margin-bottom: 22px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 6px">
        {{ defaultBaselineName }} → {{ defaultCompareName }} 最该先知道的坑
      </h2>
      <ul style="margin: 0; padding-left: 18px">
        <li v-for="p in topPitfalls" :key="p.id" style="margin: 6px 0">
          {{ p.title }}
          <span class="pc-hint">（{{ '★'.repeat(p.severity) }}）</span>
        </li>
      </ul>
      <p style="margin: 10px 0 0">
        <RouterLink :to="pitfallsEntry">看完整迁移陷阱 →</RouterLink>
      </p>
    </section>

    <section class="pc-panel">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 6px">内容规模</h2>
      <p class="pc-hint" style="margin: 0">
        {{ enabledLanguageMeta.length }} 门语言（{{ enabledLanguageIds.map(nameOf).join(' / ') }}）
        · {{ manifest.counts.features }} 个对照点 · {{ manifest.counts.boxes }} 个对比框
        · {{ manifest.pairs.length }} 个迁移方向
      </p>
    </section>
  </div>
</template>

<style scoped>
.pc-steps {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
}
.pc-steps li + li {
  margin-top: 6px;
}
/* `.pc-tree a` 是 display:block（列表里的链接要占满一行好点），
   所以「（N 项）」得靠 flex 拉到同一行，否则会掉到下一行去 */
.pc-entry-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.pc-baseline-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pc-baseline-main {
  display: block;
  text-decoration: none;
  color: inherit;
}
.pc-baseline-card:hover {
  border-color: var(--pc-accent);
}
/* 次级入口：与主链接拉开层级，别看起来像同一张卡片的第二行标题 */
.pc-baseline-lang {
  margin-top: auto;
  align-self: flex-start;
}
</style>
