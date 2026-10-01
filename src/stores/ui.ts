import { usePreferredDark } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { usePersistedState } from '@/composables/usePersistedState'

export type ThemePreference = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'comfortable'
/** 三种展示模式 —— 是同一个对比视图的三种布局，不是三个视图（§5.4） */
export type ViewMode = 'matrix' | 'side-by-side' | 'baseline-diff'

export const useUiStore = defineStore('ui', () => {
  // 枚举型设置一律带 allowed 守卫：存值非法时回退默认，避免「一个选项都没高亮」的静默失败
  const themePreference = usePersistedState<ThemePreference>('ui:theme', 'system', {
    allowed: ['light', 'dark', 'system'] as const,
  })
  const density = usePersistedState<Density>('ui:density', 'compact', {
    allowed: ['compact', 'comfortable'] as const,
  })
  const viewMode = usePersistedState<ViewMode>('ui:viewMode', 'matrix', {
    allowed: ['matrix', 'side-by-side', 'baseline-diff'] as const,
  })
  const onlyDifferent = usePersistedState<boolean>('ui:onlyDifferent', false)

  const prefersDark = usePreferredDark()
  const resolvedTheme = computed<'light' | 'dark'>(() =>
    themePreference.value === 'system'
      ? prefersDark.value
        ? 'dark'
        : 'light'
      : themePreference.value,
  )

  function applyToDocument(): void {
    if (typeof document === 'undefined') return
    const el = document.documentElement
    el.dataset.theme = resolvedTheme.value
    el.dataset.density = density.value
    el.lang = 'zh-CN'
  }

  watch([resolvedTheme, density], applyToDocument, { immediate: true })

  function cycleTheme(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark']
    const i = order.indexOf(themePreference.value)
    themePreference.value = order[(i + 1) % order.length]!
  }

  return {
    themePreference,
    resolvedTheme,
    density,
    viewMode,
    onlyDifferent,
    applyToDocument,
    cycleTheme,
  }
})
