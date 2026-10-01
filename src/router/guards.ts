import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import { useContentStore } from '@/stores/content'

/**
 * 路由守卫 —— 在这里把「分片内容」加载完，视图组件就能同步渲染。
 *
 * 为什么不用组件内 await / <Suspense>：
 *  预渲染（SSG）与客户端 CSR 必须走**同一条取数路径**，否则会出现「预渲染出来的 HTML
 *  和客户端渲染的结果不一致」。守卫里 await 之后，两条路径都变成同步渲染（§7.1）。
 */
export function installGuards(router: Router, pinia: Pinia): void {
  router.beforeEach(async (to) => {
    const content = useContentStore(pinia)

    if (to.name === 'chapter') {
      const chapterId = `${String(to.params.topicId ?? '')}/${String(to.params.chapterSlug ?? '')}`
      if (!content.isValidChapter(chapterId)) return { name: 'not-found' }
      const chapter = await content.ensureChapter(chapterId)
      if (!chapter) return { name: 'not-found' }
      return true
    }

    if (to.name === 'feature') {
      const featureId = `${String(to.params.topicId ?? '')}/${String(to.params.slug ?? '')}`
      const feature = await content.ensureFeature(featureId)
      if (!feature) return { name: 'not-found' }
      return true
    }

    if (to.name === 'roadmap') {
      const langId = String(to.params.langId ?? '')
      const { useLanguageStore } = await import('@/stores/language')
      const languages = useLanguageStore(pinia)
      if (!languages.allMeta.some((m) => m.id === langId)) return { name: 'not-found' }
      return true
    }

    return true
  })
}
