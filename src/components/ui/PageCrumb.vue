<script setup lang="ts">
/**
 * 面包屑。
 *
 * 抽出来之前，这段标记在 ChapterCompareView 与 FeatureView 里各写了一遍，
 * 而陷阱 / 词典 / 路线三页一条都没有 —— 列表页只能靠左栏回退，深链进来时更明显。
 *
 * 最后一项默认不可点（它就是当前页）。传了 `to` 的项一律渲染成链接 ——
 * 由调用方决定哪一级可回跳，组件不猜。
 */
import { RouterLink } from 'vue-router'

defineProps<{ items: Array<{ label: string; to?: string }> }>()
</script>

<template>
  <nav class="pc-crumb" aria-label="面包屑">
    <template v-for="(item, i) in items" :key="`${i}-${item.label}`">
      <span v-if="i" class="pc-crumb-sep" aria-hidden="true">/</span>
      <RouterLink v-if="item.to" :to="item.to">{{ item.label }}</RouterLink>
      <span v-else aria-current="page">{{ item.label }}</span>
    </template>
  </nav>
</template>

<style scoped>
/* 分隔符用 margin 而不是字面空格 —— 模板里的换行会被 Vue 压成单个空格，
   间距随缩进和格式化漂移，改起来不可预期。 */
.pc-crumb-sep {
  margin: 0 4px;
}
</style>
