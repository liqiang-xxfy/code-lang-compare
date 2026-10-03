<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import ChapterToc from '@/components/compare/ChapterToc.vue'
import MatrixLayout from '@/components/compare/MatrixLayout.vue'
import SideBySideLayout from '@/components/compare/SideBySideLayout.vue'
import { useI18n } from '@/composables/useI18n'
import type { CatalogChapter, LanguageMeta, RenderedBox, Section } from '@/schemas'
import { useUiStore } from '@/stores/ui'

defineProps<{
  section: Section
  baseline: string
  chapter: CatalogChapter
  /** 当前可见的列（已按「本章真有内容」裁剪），顺序与布局一致 */
  columns: LanguageMeta[]
  /** key = 语言 id → feature id；已加载的列才有键 */
  boxes: Record<string, Record<string, RenderedBox>>
}>()
const ui = useUiStore()
const { t } = useI18n()

/**
 * 窄屏降级（§7.3）：矩阵在 375px 上必然要横向拖，阅读体验很差。
 * 这里不是改用户的设置，而是只影响**渲染**——用户选的 viewMode 仍然保留，
 * 屏幕变宽后自动回到他选的那个模式。
 */
const isNarrow = useMediaQuery('(max-width: 768px)')
const effectiveMode = computed(() => (isNarrow.value ? 'side-by-side' : ui.viewMode))
const degraded = computed(() => isNarrow.value && ui.viewMode !== 'side-by-side')
</script>

<template>
  <div>
    <p v-if="degraded" class="pc-note-box" style="margin: 0 0 12px">
      窄屏下已自动切换为「{{ t('viewMode.sideBySide') }}」：矩阵的横向滚动在手机上不便阅读。
      屏幕变宽后会回到你选择的方式。
    </p>

    <!-- 页内目录只在并排模式下有意义：矩阵本身就是表，行靠表头对齐 -->
    <ChapterToc
      v-if="effectiveMode === 'side-by-side'"
      :features="chapter.features"
      :section="section"
    />

    <!--
      两种展示模式共用同一份数据、同一套语言选择状态：
      切模式不跳路由，因此当前的基准语言、语言列、滚动位置全部保留（§5.4 / §7.3）
    -->
    <SideBySideLayout
      v-if="effectiveMode === 'side-by-side'"
      :section="section"
      :baseline="baseline"
      :chapter="chapter"
      :columns="columns"
      :boxes="boxes"
    />
    <MatrixLayout
      v-else
      :section="section"
      :baseline="baseline"
      :chapter="chapter"
      :columns="columns"
      :boxes="boxes"
    />
  </div>
</template>
