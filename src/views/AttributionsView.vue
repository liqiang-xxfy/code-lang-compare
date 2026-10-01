<script setup lang="ts">
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getAttributions, manifest } from '@/content/repository'

const { t } = useI18n()
const payload = getAttributions()

usePageMeta(
  () => t('nav.attributions'),
  () => '内容来源与许可台账：每个来源要求什么、我们在哪履行了这个义务、用在了哪些条目上。',
)
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ t('nav.attributions') }}</h1>
      <p>
        这个页面是<strong>合规的可核对落点</strong>：把「某个许可要求我做什么」和「我在哪做到了」
        一一对上，而不是只在 README 里写一句「遵循 MIT」。
      </p>
      <p class="pc-hint">
        站点自身代码与原创内容采用 {{ payload.siteLicense }}。台账生成于
        {{ payload.generatedAt.slice(0, 10) }}。
      </p>
    </section>

    <article
      v-for="entry in payload.entries"
      :id="entry.sourceId"
      :key="entry.sourceId"
      class="pc-panel"
      style="margin-bottom: 14px"
    >
      <h2 style="font-size: var(--pc-fs-lg)">
        {{ entry.sourceId }}
        <span class="pc-tag" style="margin-left: 6px">{{ entry.license }}</span>
      </h2>

      <dl class="pc-attr">
        <dt>来源</dt>
        <dd>
          <a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer">
            {{ entry.url }}
          </a>
          <span v-else>本站原创</span>
        </dd>
        <dt>许可义务</dt>
        <dd>{{ entry.obligation }}</dd>
        <dt>履行位置</dt>
        <dd>
          <span v-for="where in entry.fulfilledAt" :key="where" class="pc-tag" style="margin-right: 6px">
            {{ where }}
          </span>
          <span v-if="!entry.fulfilledAt.length" style="color: var(--pc-eq-divergent)">
            未登记（构建会阻断）
          </span>
        </dd>
        <dt>用于</dt>
        <dd>
          <template v-if="entry.usedBy.length">
            <span v-for="item in entry.usedBy.slice(0, 12)" :key="item" class="pc-tag" style="margin: 0 6px 4px 0">
              {{ item }}
            </span>
            <span v-if="entry.usedBy.length > 12" class="pc-hint">
              …共 {{ entry.usedBy.length }} 条
            </span>
          </template>
          <span v-else class="pc-hint">暂无内容使用</span>
        </dd>
      </dl>
    </article>

    <section class="pc-panel">
      <h2 style="font-size: var(--pc-fs-lg)">关于 AI 生成内容</h2>
      <p class="pc-hint" style="margin-bottom: 0">
        标注为 <code>llm</code> 来源的条目由大模型生成、尚未经过人工复核，因此<strong>不登记许可证</strong> ——
        模型输出不产生可署名的许可，强行填 MIT / GFDL 反而是错误的许可陈述。
        这类内容的合规责任由「人工审阅记录 + 页面上的未校对标记」承担。
        当前共 {{ manifest.counts.snippets }} 条实现，其中
        {{ manifest.counts.byState.reviewed ?? 0 }} 条已校对、{{ manifest.counts.byState.draft ?? 0 }} 条待校对。
      </p>
    </section>
  </div>
</template>

<style scoped>
.pc-attr {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  margin: 10px 0 0;
  font-size: var(--pc-fs-sm);
}
.pc-attr dt {
  color: var(--pc-text-mute);
  font-weight: 600;
  white-space: nowrap;
}
.pc-attr dd {
  margin: 0;
  color: var(--pc-text-soft);
}
</style>
