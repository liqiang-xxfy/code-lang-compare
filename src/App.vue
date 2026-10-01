<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import SideNav from '@/components/ui/SideNav.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import DensityToggle from '@/components/ui/DensityToggle.vue'
import { useI18n } from '@/composables/useI18n'
import { hasRoadmap, manifest } from '@/content/repository'
import { enabledLanguageMeta, siteInfo } from '@/generated/registry.gen'

const { t } = useI18n()
const route = useRoute()

/** 第一个章节与第一条路线都由数据决定，不在模板里写死路径 */
const firstChapterPath = computed(() => {
  const chapter = manifest.topics[0]?.chapters[0]
  return chapter ? `/compare/${chapter.id}` : '/'
})

/** 路线图只指向「确实有内容」的语言；一门都没有时整项导航隐藏（避免死链） */
const roadmapPath = computed(() => {
  const lang = enabledLanguageMeta.find((m) => hasRoadmap(m.id))
  return lang ? `/roadmap/${lang.id}` : null
})

const navItems = computed(() =>
  [
    { to: '/', label: t('nav.home'), match: 'home' },
    { to: firstChapterPath.value, label: t('nav.basics'), match: 'chapter' },
    { to: '/search', label: t('nav.search'), match: 'search' },
    { to: '/pitfalls', label: t('nav.pitfalls'), match: 'pitfalls' },
    { to: '/glossary', label: t('nav.glossary'), match: 'glossary' },
    roadmapPath.value
      ? { to: roadmapPath.value, label: t('nav.roadmap'), match: 'roadmap' }
      : null,
    { to: '/attributions', label: t('nav.attributions'), match: 'attributions' },
  ].filter((item): item is { to: string; label: string; match: string } => item !== null),
)
</script>

<template>
  <div class="pc-shell">
    <a class="pc-skip" href="#main">跳到主要内容</a>

    <header class="pc-header">
      <RouterLink to="/" class="pc-brand">{{ siteInfo.name }}</RouterLink>

      <nav class="pc-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :class="{ 'router-link-active': route.name === item.match }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="pc-controls">
        <DensityToggle />
        <ThemeToggle />
      </div>
    </header>

    <div class="pc-body">
      <SideNav />
      <main id="main" class="pc-main">
        <RouterView />
      </main>
    </div>
  </div>
</template>
