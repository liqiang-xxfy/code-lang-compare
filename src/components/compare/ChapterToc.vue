<script setup lang="ts">
/**
 * 章节的页内目录（跳转到某个对照点）。
 *
 * 为什么需要：一章十几个对照点在「卡片并排」下是十几段纵向堆叠，实测整页 5600px 以上。
 * 读到第 5 个就丢位置感，而左栏的章节级导航粒度太粗帮不上 —— 它只能带你到章，
 * 不能带你到章里的某一条。
 *
 * **只在「卡片并排」下渲染**：矩阵本身就是一张表，行与行之间靠表头对齐，
 * 再加一条目录是重复的导航。
 *
 * 目录列的是**全部**对照点，而矩阵/并排可能被「只看有差异的」过滤掉几条 ——
 * 那种情况下点目录会跳不到。接受这个不完美：过滤是用户自己开的，
 * 关掉即可；反过来让目录跟着过滤走，会出现「目录里少了几条但我不知道为什么」。
 */
import { featureAnchor } from '@/content/repository'
import type { CatalogFeature, Section } from '@/schemas'

const props = defineProps<{ features: CatalogFeature[]; section: Section; chapter: string }>()

/** 锚点用全局 id —— 布局层用的是同一个函数，各拼一套会出现「目录点得到、布局锚不上」 */
const anchorOf = (featureId: string) => featureAnchor(`${props.section}/${props.chapter}/${featureId}`)
</script>

<template>
  <nav v-if="features.length > 1" class="pc-toc" aria-label="本章对照点">
    <span class="pc-toc-label">本章对照点</span>
    <ul>
      <li v-for="f in features" :key="f.id">
        <a :href="`#${anchorOf(f.id)}`">{{ f.title }}</a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.pc-toc {
  margin: 0 0 14px;
  padding: 8px 12px;
  border: 1px solid var(--pc-border);
  border-radius: var(--pc-radius);
  background: var(--pc-bg-soft);
  font-size: var(--pc-fs-sm);
}
.pc-toc-label {
  display: block;
  margin-bottom: 4px;
  font-size: var(--pc-fs-xs);
  font-weight: 600;
  color: var(--pc-text-mute);
}
.pc-toc ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
