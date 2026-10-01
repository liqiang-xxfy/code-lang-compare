/**
 * 每路由的 title / description（D-B 要求的 SEO 落点之一）
 *
 * 构建期：scripts/build/finalize-dist.mjs 把同样的值直接写进每个路由的静态 HTML，
 *          这样不执行 JS 的爬虫也能读到正确的标题与摘要。
 * 运行期：这里在客户端导航时同步更新，避免「切了页面标题还是旧的」。
 */
import { watchEffect } from 'vue'
import { siteInfo } from '@/generated/registry.gen'

function setMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export function pageTitle(title?: string): string {
  return title ? `${title} · ${siteInfo.name}` : siteInfo.name
}

export function usePageMeta(
  getTitle: () => string | undefined,
  getDescription?: () => string | undefined,
): void {
  if (typeof document === 'undefined') return
  watchEffect(() => {
    document.title = pageTitle(getTitle())
    setMeta('description', getDescription?.() ?? siteInfo.shortDescription)
  })
}
