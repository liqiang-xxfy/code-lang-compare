<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { usePageMeta } from '@/composables/usePageMeta'
import { getPitfalls, manifest } from '@/content/repository'
import { baselineLanguageId, enabledLanguageMeta, getLanguageMeta, siteInfo } from '@/generated/registry.gen'

const { t } = useI18n()
usePageMeta(
  () => undefined,
  () => siteInfo.shortDescription,
)

const topics = computed(() => manifest.topics)
const counts = manifest.counts
const topPitfalls = computed(() => getPitfalls().filter((p) => p.fromBaseline).slice(0, 3))
const baseline = computed(() => getLanguageMeta(baselineLanguageId))
</script>

<template>
  <div>
    <section class="pc-page-head">
      <h1>{{ siteInfo.name }}</h1>
      <p>{{ siteInfo.shortDescription }}</p>
      <p class="pc-hint" style="margin-top: 8px">
        当前以 <strong>{{ baseline?.name }}</strong> 为基准，已接入
        <strong>{{ enabledLanguageMeta.length }}</strong> 门语言；共
        {{ counts.features }} 个对照特性、{{ counts.snippets }} 条代码实现。
      </p>
    </section>

    <div class="pc-grid-cards" style="margin-bottom: 22px">
      <RouterLink v-for="lang in enabledLanguageMeta" :key="lang.id" :to="`/lang/${lang.id}`" class="pc-panel">
        <h2 style="font-size: var(--pc-fs-lg)">{{ lang.name }}</h2>
        <p class="pc-hint" style="margin: 6px 0 0">
          {{ lang.typing === 'static' ? '静态类型' : lang.typing === 'gradual' ? '渐进类型' : '动态类型' }}
          · {{ lang.memoryModel === 'gc' ? 'GC' : lang.memoryModel === 'arc' ? 'ARC' : '手动内存' }}
          <template v-if="lang.typeSystem">
            · {{ lang.typeSystem === 'nominal' ? '名义类型' : '结构化类型' }}
          </template>
        </p>
        <p class="pc-hint" style="margin: 4px 0 0">
          查看「心智模型对照表」与语言元信息 →
        </p>
      </RouterLink>

      <RouterLink to="/pitfalls" class="pc-panel">
        <h2 style="font-size: var(--pc-fs-lg)">{{ t('nav.pitfalls') }}</h2>
        <p class="pc-hint" style="margin: 6px 0 0">
          按「症状」检索的迁移陷阱清单，置顶 JS 开发者必踩项 →
        </p>
      </RouterLink>
    </div>

    <section v-for="topic in topics" :key="topic.id" style="margin-bottom: 22px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">{{ topic.title }}</h2>
      <div class="pc-grid-cards">
        <RouterLink
          v-for="chapter in topic.chapters"
          :key="chapter.id"
          :to="`/compare/${chapter.id}`"
          class="pc-panel"
        >
          <strong>{{ chapter.title }}</strong>
          <p class="pc-hint" style="margin: 4px 0 0">
            {{ chapter.featureIds.length }} 个特性
          </p>
        </RouterLink>
      </div>
    </section>

    <section v-if="topPitfalls.length" style="margin-bottom: 22px">
      <h2 style="font-size: var(--pc-fs-xl); margin-bottom: 10px">JS 开发者必踩</h2>
      <ul class="pc-checklist">
        <li v-for="p in topPitfalls" :key="p.id">
          <span class="pc-stars" aria-hidden="true">{{ '★'.repeat(p.severity) }}</span>
          <span>{{ p.title }}</span>
        </li>
      </ul>
      <p style="margin-top: 8px">
        <RouterLink to="/pitfalls">查看完整清单 →</RouterLink>
      </p>
    </section>
  </div>
</template>
