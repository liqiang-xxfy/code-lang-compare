<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import SideNav from '@/components/ui/SideNav.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import DensityToggle from '@/components/ui/DensityToggle.vue'
import { useI18n } from '@/composables/useI18n'
import { compareEntryPath, sectionOfRoute } from '@/router'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'
import { siteInfo } from '@/generated/registry.gen'

const { t } = useI18n()
const route = useRoute()
const languages = useLanguageStore()
const ui = useUiStore()

/**
 * 基准与板块以**路由参数**为准写回 store。
 *
 * 为什么在这里而不是在每个视图里：进入/离开的时机由 router 统一给，
 * 视图拿到的 `orderedMeta` 才是对的；分散在各视图里必然出现「切换路由时
 * 有一帧用的是上一页的基准」。
 *
 * 板块直接读 `params.section` —— 此前它靠路由名逐个列举五个具名路由，
 * 加板块必然漏；参数化之后板块就在参数里，不会再漂。
 */
watch(
  () => [route.params.baseline, route.params.section] as const,
  ([baseline]) => {
    /*
     * 先救回「唯一的勾选恰好是本页基准」那种退化（点「我熟悉 Python」时，
     * 默认对比语言 Python 被基准吃掉，整页只剩一列），再写路由上下文。
     *
     * 路由守卫里也调了同一个函数 —— 那里是为了**按修正后的集合加载分片**；
     * 这里是为了**渲染它的那个 store 实例**。两处都留：守卫与首屏渲染未必
     * 跑在同一个 store 上（整页加载时首屏那一路就不经过守卫），少一处就会出现
     * 「内存里是一门、页面上是另一门」。函数本身幂等，重复调用无副作用。
     */
    if (typeof baseline === 'string') languages.ensureCompareFor(baseline)
    languages.setRouteContext(
      typeof baseline === 'string' ? baseline : null,
      sectionOfRoute(route),
    )
  },
  { immediate: true },
)

/**
 * 顶部「多语言对比」的落点 —— 与 `/compare/<基准>` 走**同一个函数**。
 *
 * 分头算的话，「点顶栏」与「敲地址」会落到不同地方，而且两边各改一次才对齐；
 * 交给路由的 redirect 决定，顶栏就只是那个地址的另一个入口。
 */
const compareEntry = computed(() => compareEntryPath(languages.effectiveBaseline))

/**
 * 侧栏开合按钮的文案：图标是 ☰，这句话同时充当 title 与 aria-label。
 * 按状态给两种说法，按钮才回答了「按下去会发生什么」。
 */
const sideNavLabel = computed(() => t(ui.sideNavOpen ? 'nav.toggleHide' : 'nav.toggleShow'))

const navItems = computed(() => [
  { to: '/', label: t('nav.home'), match: 'home' },
  { to: compareEntry.value, label: t('nav.compare'), match: 'compare' },
  { to: '/search', label: t('nav.search'), match: 'search' },
])

/**
 * 激活态判定。
 *
 * 「多语言对比」覆盖的是一整棵子树（五个板块 + 语言入口 + 特性详情），
 * 所以它按**路径前缀**判，其余两项仍按路由名判 —— 用 route.name 判会让
 * 进入任一子板块后顶部就失去高亮。
 */
const isActive = (item: { match: string }): boolean =>
  item.match === 'compare'
    ? route.path.startsWith('/compare/') ||
      route.name === 'feature' ||
      route.name === 'language'
    : route.name === item.match

</script>

<template>
  <div class="pc-shell">
    <a class="pc-skip" href="#main">跳到主要内容</a>

    <header class="pc-header">
      <!--
        侧栏开合按钮放在最左：它控制的是紧挨着的左侧那一栏，位置本身就是说明。
        用 aria-expanded + aria-controls 而不是只给个图标 —— 图标对屏幕阅读器
        等于没有，而这是全站导航的开关。
      -->
      <button
        type="button"
        class="pc-btn"
        :aria-expanded="ui.sideNavOpen"
        aria-controls="pc-sidenav"
        :title="sideNavLabel"
        :aria-label="sideNavLabel"
        @click="ui.toggleSideNav()"
      >
        <span aria-hidden="true">☰</span>
      </button>

      <RouterLink to="/" class="pc-brand">{{ siteInfo.name }}</RouterLink>

      <nav class="pc-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.match"
          :to="item.to"
          :class="{ 'router-link-active': isActive(item) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <!-- 基准语言不在顶栏：它在左侧菜单栏顶部吸顶（SideNav） -->
      <div class="pc-controls">
        <DensityToggle />
        <ThemeToggle />
      </div>
    </header>

    <div class="pc-body">
      <!--
        左侧菜单**每一页都有**，首页也不例外：它是全站唯一按章节展开的入口，
        首页自带的那几块导览是"第一次来该看什么"，两件事不重叠。
        它可以被收起（状态在 ui store 里，持久化），但**默认展开** —— 收起是
        用户读长表格时腾宽度的动作，不该是所有人的初始状态。
      -->
      <SideNav />
      <main id="main" class="pc-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>
