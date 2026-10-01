<script setup lang="ts">
/** 受限 Markdown 的渲染产物容器（构建期已用 markdown-it + 白名单渲染，禁裸 HTML） */
defineProps<{ html?: string }>()
</script>

<template>
  <div v-if="html" class="pc-md" v-html="html" />
</template>
