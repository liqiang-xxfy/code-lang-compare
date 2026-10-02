<script setup lang="ts">
/**
 * 板块页的派发壳。
 *
 * 路由只有两条（章节型 / 列表型），板块是 `params.section` —— 到底渲染哪个组件，
 * 由板块注册表的 `shape` 与 `renderer` 决定。有了这一层，**加一个章节型板块
 * 不需要碰路由表**：它自动复用 ChapterCompareView。
 *
 * 为什么不让路由表直接指向组件：路由表是静态的，而板块是数据；
 * 要按数据选组件，中间就得有一层壳。这也是「加板块零代码」能成立的原因。
 */
import { computed, defineAsyncComponent, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { sectionDefOf } from '@/content/repository'
import { sectionOfRoute } from '@/router'
import NotFoundView from './NotFoundView.vue'

/** 章节型板块的默认渲染器 —— 新的章节型板块零代码复用它 */
const ChapterCompareView = defineAsyncComponent(() => import('./ChapterCompareView.vue'))

/**
 * 列表型板块的渲染器注册表，键是板块在 registry.yaml 里声明的 `renderer`。
 *
 * 列表型**刻意没有默认渲染器**：三种列表的交互差异很大（陷阱有搜索与严重度筛选、
 * 路线有进度持久化、词典是简单词条列表），硬套一个通用模板会把它们削平成
 * 最弱的那一个。新板块若复用已有交互，写同一个 renderer 名即可 —— 仍然零代码；
 * 只有全新交互才需要在这里加一行、并新增一个组件，那是新 UI，本就不该免。
 */
const RENDERERS: Record<string, Component> = {
  pitfalls: defineAsyncComponent(() => import('./PitfallsView.vue')),
  glossary: defineAsyncComponent(() => import('./GlossaryView.vue')),
  roadmap: defineAsyncComponent(() => import('./RoadmapView.vue')),
}

const route = useRoute()

const renderer = computed<Component | null>(() => {
  const section = sectionOfRoute(route)
  if (!section) return null
  const def = sectionDefOf(section)
  if (!def) return null
  if (def.shape === 'chapter') return ChapterCompareView
  return (def.renderer && RENDERERS[def.renderer]) || null
})
</script>

<template>
  <component :is="renderer" v-if="renderer" />
  <NotFoundView v-else />
</template>
