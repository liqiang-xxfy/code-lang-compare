<script setup lang="ts">
import { computed, ref } from 'vue'
import EquivalenceBadge from '@/components/compare/EquivalenceBadge.vue'
import { useI18n } from '@/composables/useI18n'
import type { Equivalence, LanguageMeta, RenderedBox } from '@/schemas'

const props = withDefaults(
  defineProps<{
    /** 一个对比框 —— 一个 feature × 一门语言 = 矩阵里的一格 */
    box: RenderedBox
    langMeta?: LanguageMeta
    /**
     * 该格按角色取到的说明（基准列取 `baselineHtml`，对比列取 `vsHtml[当前基准]`）。
     *
     * **取值不在这里做** —— 那是 [boxView.ts](../../content/boxView.ts) 的职责，
     * 矩阵 / 并排 / 特性页三处共用同一个判断。这里只负责显示。
     */
    explanationHtml?: string
    /** 该格该显示的徽章；`null` = 不渲染（基准列，或尚未判定） */
    equivalence?: Equivalence | null
    /**
     * 默认**开**：并排视图里两侧行号是横向对齐阅读的基准（同一行的左右两列对得上）。
     * 要关掉的场景（如窄屏单列）可以显式传 false。
     */
    showLineNumbers?: boolean
    /** 超过这个行数默认裁剪显示；裁剪用 CSS max-height，**内容始终留在 DOM 里**（爬虫可读） */
    clipThreshold?: number
    /**
     * 本格是否为基准列。基准列的徽章恒不渲染（它就是参照系本身，
     * 那枚「=」是自指、零信息量；列头已有「基准」标记）。
     */
    isBaseline?: boolean
  }>(),
  {
    showLineNumbers: true,
    clipThreshold: 30,
    isBaseline: false,
    equivalence: null,
  },
)

const { t } = useI18n()
const expanded = ref(false)
const copied = ref(false)

/**
 * 「本语言无此概念」的**显式声明** —— 与「还没写」（键缺失）是两回事，
 * 后者由布局层渲染成更淡的留白。判据来自 `box.absent`，不再从 equivalence 推。
 */
const isAbsent = computed(() => props.box.absent)

/**
 * 校对爬坡期的临时开关：正文目前全站都是 `draft`，徽章会出现在每一格的列头上，
 * 反而把真正要看的东西（代码与差异说明）淹掉。设为 `false` 暂时隐藏；
 * S8 校对收口、`publishPolicy` 切到 `reviewed-only` 之际设回 `true` 恢复。
 *
 * **只隐藏显示** —— `box.reviewState` 的数据、`review.draft` / `review.draftHint`
 * 的 i18n 文案都原样保留，恢复时改这一行即可（模板与样式都不用动）。
 */
const SHOW_DRAFT_BADGE = false

const clipable = computed(() => props.box.lineCount > props.clipThreshold)
const clipped = computed(() => clipable.value && !expanded.value)
const isDualTheme = computed(() => Boolean(props.box.htmlDark))

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.box.code)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

</script>

<template>
  <div class="pc-code" :class="{ 'with-lines': showLineNumbers, 'is-absent': isAbsent }">
    <div class="pc-code-head">
      <strong>{{ langMeta?.name ?? box.lang }}</strong>
      <span v-if="langMeta" class="pc-hint">{{ langMeta.fileExtension }}</span>
      <!-- `equivalence` 由调用方按角色解析：基准列是 null，absent 的格子恒为 ∅ -->
      <EquivalenceBadge v-if="!isBaseline && equivalence" :value="equivalence" />
      <span
        v-if="SHOW_DRAFT_BADGE && box.reviewState === 'draft'"
        class="pc-badge-draft"
        :title="t('review.draftHint')"
      >
        {{ t('review.draft') }}
      </span>
      <span class="pc-spacer" />
      <button v-if="box.code" class="pc-btn pc-btn-xs" type="button" @click="copyCode">
        {{ copied ? t('code.copied') : t('code.copy') }}
      </button>
    </div>

    <div v-if="isAbsent" class="pc-cell-empty">{{ t('code.noConcept') }}</div>

    <template v-if="box.code">
      <!--
        多段对照（如「错误写法 / 正确写法」）：每段一个代码块，各有自己的行号空间与注记。
        段标签是并排视图里唯一能说明「第 2 段在跟哪一段比」的东西。
      -->
      <div v-if="box.blocks?.length" class="pc-blocks">
        <div v-for="(b, i) in box.blocks" :key="i" class="pc-code-block">
          <div class="pc-block-label">{{ b.label }}</div>
          <div class="pc-code-body" :class="{ 'is-clipped': clipped, 'is-dual': isDualTheme }">
            <div v-if="!isDualTheme" v-html="b.html" />
            <template v-else>
              <div class="pc-theme-light" v-html="b.html" />
              <div class="pc-theme-dark" v-html="b.htmlDark" />
            </template>
          </div>
        </div>
      </div>

      <!-- 单段：与加多段之前逐字节相同的渲染路径 -->
      <div v-else class="pc-code-body" :class="{ 'is-clipped': clipped, 'is-dual': isDualTheme }">
        <!-- 首选：css-variables 主题，一份 HTML，明暗由 CSS 变量切换（ADR-04） -->
        <div v-if="!isDualTheme" v-html="box.html" />
        <!-- 降级：双主题各一份，由 CSS 按 data-theme 显示其一 -->
        <template v-else>
          <div class="pc-theme-light" v-html="box.html" />
          <div class="pc-theme-dark" v-html="box.htmlDark" />
        </template>
      </div>

      <!--
        页脚只在**真需要展开按钮**时渲染。它曾经以「N 行」为常驻内容、
        后来又承载差异摘要与分段提示，两者都随 S9 删除 —— 现在它唯一的内容
        就是裁剪后的「展开」，没有可展开的格子就不该留一条空带。
      -->
      <div v-if="clipable" class="pc-code-foot">
        <span class="pc-spacer" />
        <button class="pc-btn pc-btn-xs" type="button" @click="expanded = !expanded">
          {{ expanded ? t('code.collapse') : t('code.expand', { n: box.lineCount }) }}
        </button>
      </div>
    </template>

    <pre v-if="box.output" class="pc-output">{{ box.output }}</pre>

    <!-- 第 ③ 槽：按角色取到的那一段说明（基准列=本语言的事实，对比列=与基准的差别） -->
    <div v-if="explanationHtml" class="pc-md pc-code-extra" v-html="explanationHtml" />
  </div>
</template>
