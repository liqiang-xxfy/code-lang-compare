<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import type { LineDiff } from '@/content/diff'
import type { LanguageMeta, RenderedSnippet } from '@/schemas'

const props = withDefaults(
  defineProps<{
    snippet: RenderedSnippet
    langMeta?: LanguageMeta
    showLineNumbers?: boolean
    /** 相对基准的行级 diff；null 表示当前展示模式不做 diff */
    diff?: LineDiff | null
    /** 超过这个行数默认裁剪显示；裁剪用 CSS max-height，**内容始终留在 DOM 里**（爬虫可读） */
    clipThreshold?: number
  }>(),
  { showLineNumbers: false, diff: null, clipThreshold: 30 },
)

const { t } = useI18n()
const expanded = ref(false)
const copied = ref(false)
const bodyRef = useTemplateRef<HTMLElement>('body')

const isAbsent = computed(() => props.snippet.equivalence === 'absent')
const clipable = computed(() => props.snippet.lineCount > props.clipThreshold)
const clipped = computed(() => clipable.value && !expanded.value)
const isDualTheme = computed(() => Boolean(props.snippet.htmlDark))
const diffSummary = computed(() => {
  const d = props.diff
  if (!d) return ''
  const parts: string[] = []
  if (d.changed.size) parts.push(`${d.changed.size} 行不同`)
  if (d.added.size) parts.push(`${d.added.size} 行新增`)
  return parts.join(' / ')
})

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.snippet.code)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

/**
 * 行级 diff 着色。
 *
 * Shiki 的 HTML 是构建期生成的，而构建期并不知道「基准语言」是谁（用户随时可切换），
 * 所以这里在渲染后按行号给 .line 补 class。属客户端增强：
 * 预渲染出的 HTML 没有色块，但内容完整，不影响索引（§7.4 / ADR-05）。
 */
function paintDiff(): void {
  const root = bodyRef.value
  if (!root) return
  const lines = root.querySelectorAll<HTMLElement>('pre.shiki code > .line')
  lines.forEach((el, index) => {
    el.classList.remove('diff-added', 'diff-changed')
    const lineNo = index + 1
    if (props.diff?.added.has(lineNo)) el.classList.add('diff-added')
    else if (props.diff?.changed.has(lineNo)) el.classList.add('diff-changed')
  })
}

watch(
  () => [props.snippet.html, props.snippet.htmlDark, props.diff, expanded.value] as const,
  async () => {
    await nextTick()
    paintDiff()
  },
  { immediate: true },
)
</script>

<template>
  <div class="pc-code" :class="{ 'with-lines': showLineNumbers }">
    <div class="pc-code-head">
      <strong>{{ langMeta?.name ?? snippet.lang }}</strong>
      <span v-if="langMeta" class="pc-hint">{{ langMeta.fileExtension }}</span>
      <EquivalenceBadge :value="snippet.equivalence" />
      <span v-for="flag in snippet.flags" :key="flag" class="pc-tag">{{ t(`flags.${flag}`) }}</span>
      <span
        v-if="snippet.reviewState === 'draft'"
        class="pc-badge-draft"
        :title="t('review.draftHint')"
      >
        {{ t('review.draft') }}
      </span>
      <span class="pc-spacer" />
      <button v-if="snippet.code" class="pc-btn pc-btn-xs" type="button" @click="copyCode">
        {{ copied ? t('code.copied') : t('code.copy') }}
      </button>
    </div>

    <div v-if="isAbsent" class="pc-cell-empty">{{ t('code.noEquivalent') }}</div>

    <template v-if="snippet.code">
      <div
        ref="body"
        class="pc-code-body"
        :class="{ 'is-clipped': clipped, 'is-dual': isDualTheme }"
      >
        <!-- 首选：css-variables 主题，一份 HTML，明暗由 CSS 变量切换（ADR-04） -->
        <div v-if="!isDualTheme" v-html="snippet.html" />
        <!-- 降级：双主题各一份，由 CSS 按 data-theme 显示其一 -->
        <template v-else>
          <div class="pc-theme-light" v-html="snippet.html" />
          <div class="pc-theme-dark" v-html="snippet.htmlDark" />
        </template>
      </div>

      <div class="pc-code-foot">
        <span>{{ snippet.lineCount }} 行</span>
        <span v-if="snippet.notes.length">· {{ snippet.notes.length }} 条差异说明</span>
        <span v-if="diffSummary">· 相对基准 {{ diffSummary }}</span>
        <span class="pc-spacer" />
        <button
          v-if="clipable"
          class="pc-btn pc-btn-xs"
          type="button"
          @click="expanded = !expanded"
        >
          {{ expanded ? t('code.collapse') : t('code.expand', { n: snippet.lineCount }) }}
        </button>
      </div>

      <ul v-if="snippet.notes.length" class="pc-notes">
        <li v-for="note in snippet.notes" :key="note.line" :data-tone="note.tone">
          <span class="pc-hint">L{{ note.line }}</span> {{ note.text }}
        </li>
      </ul>
    </template>

    <pre v-if="snippet.output" class="pc-output">{{ snippet.output }}</pre>

    <div v-if="snippet.bodyHtml" class="pc-md pc-code-extra" v-html="snippet.bodyHtml" />
  </div>
</template>
