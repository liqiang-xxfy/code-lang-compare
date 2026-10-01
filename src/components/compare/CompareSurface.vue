<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import DiffFilterBar from '@/components/compare/DiffFilterBar.vue'
import LanguagePicker from '@/components/compare/LanguagePicker.vue'
import MatrixLayout from '@/components/compare/MatrixLayout.vue'
import SideBySideLayout from '@/components/compare/SideBySideLayout.vue'
import { useI18n } from '@/composables/useI18n'
import type { RenderedChapter } from '@/schemas'
import { useUiStore } from '@/stores/ui'

defineProps<{ chapter: RenderedChapter }>()
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
    <DiffFilterBar />
    <div style="margin-bottom: 14px">
      <LanguagePicker />
    </div>

    <p v-if="degraded" class="pc-note-box" style="margin: 0 0 12px">
      窄屏下已自动切换为「{{ t('viewMode.sideBySide') }}」：矩阵的横向滚动在手机上不便阅读。
      屏幕变宽后会回到你选择的方式。
    </p>

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
