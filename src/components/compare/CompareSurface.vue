<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import ChapterToc from '@/components/compare/ChapterToc.vue'
import DiffFilterBar from '@/components/compare/DiffFilterBar.vue'
import EquivalenceBaselineNote from '@/components/compare/EquivalenceBaselineNote.vue'
import MatrixLayout from '@/components/compare/MatrixLayout.vue'
import SideBySideLayout from '@/components/compare/SideBySideLayout.vue'
import { useI18n } from '@/composables/useI18n'
import { enabledLanguageMeta } from '@/generated/registry.gen'
import type { RenderedChapter } from '@/schemas'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ chapter: RenderedChapter }>()
const ui = useUiStore()
const { t } = useI18n()

/**
 * 本模块目前对照了哪几门语言。
 *
 * 覆盖范围没铺满时要说明，否则用户会以为「勾了 Go 却没反应」是坏了 ——
 * 而实际是这个模块只写了其中几门。宁可多一句说明，也不要一个看起来失灵的控件。
 */
const coveredNames = computed(() => {
  const present = new Set(props.chapter.features.flatMap((f) => Object.keys(f.snippets)))
  return enabledLanguageMeta.filter((m) => present.has(m.id)).map((m) => m.name)
})
const coverageIncomplete = computed(() => coveredNames.value.length < enabledLanguageMeta.length)

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
    <DiffFilterBar />
    <EquivalenceBaselineNote />

    <p v-if="coverageIncomplete" class="pc-hint" style="margin: -4px 0 12px">
      {{ t('sections.scopeHint', { langs: coveredNames.join('、') }) }}
    </p>

    <p v-if="degraded" class="pc-note-box" style="margin: 0 0 12px">
      窄屏下已自动切换为「{{ t('viewMode.sideBySide') }}」：矩阵的横向滚动在手机上不便阅读。
      屏幕变宽后会回到你选择的方式。
    </p>

    <!-- 页内目录只在并排模式下有意义：矩阵本身就是表，行靠表头对齐 -->
    <ChapterToc
      v-if="effectiveMode === 'side-by-side'"
      :features="chapter.features"
    />

    <!--
      三种展示模式共用同一份数据、同一套语言选择状态：
      切模式不跳路由，因此当前的基准语言、语言列、滚动位置全部保留（§5.4 / §7.3）
    -->
    <SideBySideLayout v-if="effectiveMode === 'side-by-side'" :chapter="chapter" />
    <MatrixLayout
      v-else
      :chapter="chapter"
      :diff-mode="effectiveMode === 'baseline-diff'"
    />
  </div>
</template>
