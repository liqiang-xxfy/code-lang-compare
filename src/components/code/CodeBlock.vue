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
    /**
     * 默认**开**：并排视图里两侧行号是横向对齐阅读的基准（同一行的左右两列对得上）。
     * 要关掉的场景（如窄屏单列）可以显式传 false。
     */
    showLineNumbers?: boolean
    /**
     * 相对基准的行级 diff，与 `snippet.blocks` 按下标对齐（单段内容长度恒为 1）。
     * null 表示当前展示模式不做 diff。
     */
    diffs?: Array<LineDiff | null> | null
    /**
     * 两侧都是多段、但段数不同 —— 无法逐段对齐。
     *
     * 此时**刻意不降级为整体 diff**：各段各有行号空间，拼起来算出来的行号
     * 对不上任何一段，着色会整体错位。宁可不着色，也不要给出错误的对位。
     */
    blocksMismatch?: boolean
    /** 超过这个行数默认裁剪显示；裁剪用 CSS max-height，**内容始终留在 DOM 里**（爬虫可读） */
    clipThreshold?: number
    /**
     * 本格是否为基准列。基准列的 equivalence 恒为 identical（它就是参照系本身），
     * 渲染那枚「=」等于自指、零信息量，因此不渲染（列头已有「基准」标记）。
     */
    isBaseline?: boolean
  }>(),
  {
    showLineNumbers: true,
    diffs: null,
    blocksMismatch: false,
    clipThreshold: 30,
    isBaseline: false,
  },
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
  let changed = 0
  let added = 0
  for (const d of props.diffs ?? []) {
    if (!d) continue
    changed += d.changed.size
    added += d.added.size
  }
  const parts: string[] = []
  if (changed) parts.push(t('code.diffChanged', { n: changed }))
  if (added) parts.push(t('code.diffAdded', { n: added }))
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
  /*
   * 按 `data-code-body` 分组着色 —— 每一段（单段内容也只有一段）各有自己的行号空间，
   * 用整体的行号去着分段的色会整体错位。组的下标与 `diffs` 一一对应。
   */
  const groups = root.querySelectorAll<HTMLElement>('[data-code-body]')
  groups.forEach((group, blockIndex) => {
    const d = props.diffs?.[blockIndex] ?? null
    group.querySelectorAll<HTMLElement>('pre.shiki code > .line').forEach((el, index) => {
      el.classList.remove('diff-added', 'diff-changed')
      const lineNo = index + 1
      if (d?.added.has(lineNo)) el.classList.add('diff-added')
      else if (d?.changed.has(lineNo)) el.classList.add('diff-changed')
    })
  })
}

watch(
  () => [props.snippet.html, props.snippet.htmlDark, props.diffs, expanded.value] as const,
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
      <EquivalenceBadge v-if="!isBaseline" :value="snippet.equivalence" />
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
      <!--
        多段对照（如「错误写法 / 正确写法」）：每段一个代码块，各有自己的行号空间与注记。
        段标签是并排视图里唯一能说明「第 2 段在跟哪一段比」的东西。
      -->
      <div v-if="snippet.blocks?.length" ref="body" class="pc-blocks">
        <div v-for="(b, i) in snippet.blocks" :key="i" class="pc-code-block">
          <div class="pc-block-label">{{ b.label }}</div>
          <div
            data-code-body
            class="pc-code-body"
            :class="{ 'is-clipped': clipped, 'is-dual': isDualTheme }"
          >
            <div v-if="!isDualTheme" v-html="b.html" />
            <template v-else>
              <div class="pc-theme-light" v-html="b.html" />
              <div class="pc-theme-dark" v-html="b.htmlDark" />
            </template>
          </div>
        </div>
      </div>

      <!-- 单段：与加多段之前逐字节相同的渲染路径 -->
      <div
        v-else
        ref="body"
        data-code-body
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
        <span>{{ t('code.lineCount', { n: snippet.lineCount }) }}</span>
        <span v-if="diffSummary">· {{ t('code.diffFromBaseline') }} {{ diffSummary }}</span>
        <span v-else-if="blocksMismatch" class="pc-hint">
          · {{ t('code.blocksMismatch') }}
        </span>
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
    </template>

    <pre v-if="snippet.output" class="pc-output">{{ snippet.output }}</pre>

    <div v-if="snippet.bodyHtml" class="pc-md pc-code-extra" v-html="snippet.bodyHtml" />
  </div>
</template>
