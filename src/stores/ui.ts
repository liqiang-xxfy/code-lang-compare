import { usePreferredDark } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { usePersistedState } from '@/composables/usePersistedState'

export type ThemePreference = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'comfortable'
/**
 * 两种展示模式 —— 同一个对比视图的两种排法，不是两个视图。
 *
 * 曾经还有第三种 `baseline-diff`（给非基准列的行级 diff 着色）与一个
 * 「只看有差异的」过滤开关，两者在 S9 一并删除：它们各自回答的问题
 * 已经由别的机制回答了 —— 差异由等价性徽章（= ≈ ≠ ∅）说明，
 * 而"哪些格子值得看"交给章节本身的取舍。留下的两个模式是纯粹的排版选择。
 */
export type ViewMode = 'matrix' | 'side-by-side'

export const useUiStore = defineStore('ui', () => {
  // 枚举型设置一律带 allowed 守卫：存值非法时回退默认，避免「一个选项都没高亮」的静默失败
  const themePreference = usePersistedState<ThemePreference>('ui:theme', 'system', {
    allowed: ['light', 'dark', 'system'] as const,
  })
  const density = usePersistedState<Density>('ui:density', 'compact', {
    allowed: ['compact', 'comfortable'] as const,
  })
  const viewMode = usePersistedState<ViewMode>('ui:viewMode', 'matrix', {
    allowed: ['matrix', 'side-by-side'] as const,
  })
  /**
   * 左侧内容导航是否展开。
   *
   * 是**用户偏好**（持久化），不是路由状态：同一个读法跨页面成立，切一次页面
   * 就把菜单弹回来会很烦。
   *
   * 首访默认值分宽窄两种，因为侧栏在两种宽度下是两种东西（见 base.css 的
   * ≤900px 媒体查询，那里的断点必须与这里一致）：
   *   · 宽屏 —— 左侧一栏，不占正文的位置，**展开**才是该有的初态
   *   · 窄屏 —— 顶栏下面的一整块，展开会把正文推下去半屏，该由用户主动点开，
   *             进来第一眼就压着内容并不是他想要的
   *
   * 这里读 matchMedia 不会造成「服务端与客户端不一致」：客户端不做 hydration
   * 而是全新挂载（见 main.ts），没有逐节点比对这回事。
   */
  const defaultSideNavOpen = (): boolean =>
    typeof window === 'undefined' || !window.matchMedia('(max-width: 900px)').matches
  const sideNavOpen = usePersistedState<boolean>('ui:sideNav', defaultSideNavOpen())

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

  function toggleSideNav(): void {
    sideNavOpen.value = !sideNavOpen.value
  }

  return {
    themePreference,
    resolvedTheme,
    density,
    viewMode,
    sideNavOpen,
    applyToDocument,
    cycleTheme,
    toggleSideNav,
  }
})
