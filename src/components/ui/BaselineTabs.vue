<script setup lang="ts">
/**
 * 基准语言切换：**平铺**三个候选，单选。挂在页内的对比语言选择条上
 * （CompareLanguageBar），与对比语言并排但**刻意不是同一种控件**。
 *
 * 为什么平铺而不是折进下拉：基准不是一个可以随手切的"视角"，它是**内容维度** ——
 * 每个基准有各自的一套内容与地址（`/compare/<基准>/...`）。平铺让读者一眼看到
 * 有几个基准可选、自己现在在哪一个，不必先展开才知道。
 *
 * 为什么与对比语言用两种形态：它们是两个层级的东西 —— 基准是**页面本身**
 * （换了它，整页内容、地址、徽章参照系全换），对比语言是**页内看到的列**。
 * 所以基准用连体分段控件（同一字段的几个取值，见 base.css 的 .pc-baseline-seg），
 * 对比语言用各自独立的 chip（.pc-btn，勾几个是几个）。形态本身在说这个区别，
 * 不必靠一句说明去解释。
 *
 * 为什么用 button + `aria-checked` 而不是原生 radio：`:checked` 是 DOM 属性，
 * 预渲染出来的 HTML 按构建期默认值写死，而返回值可能来自 localStorage ——
 * 原生 radio 会在 hydration 时被逐个修补。用属性表达选中态，与 DensityToggle /
 * ThemeToggle 保持同一形态（见 HomeView 里对 hydration 的同一约束）。
 *
 * 切换走**导航**（见 useBaselineSwitch）—— 每个基准是一套独立内容，要能分享。
 * 与旁边对比语言的另一个区别：点它会让页面**跳走**，点对比语言只重画当前页。
 */
import { ref } from 'vue'
import { useBaselineSwitch } from '@/composables/useBaselineSwitch'
import { useI18n } from '@/composables/useI18n'
import { useLanguageStore } from '@/stores/language'

const languages = useLanguageStore()
const switchBaseline = useBaselineSwitch()
const { t } = useI18n()

const root = ref<HTMLElement | null>(null)

/** 方向键在组内移动焦点并直接切换 —— radiogroup 的标准键盘行为 */
function onArrow(from: number, delta: number): void {
  const list = languages.baselineCandidates
  if (list.length < 2) return
  const next = (from + delta + list.length) % list.length
  const target = list[next]
  if (!target) return
  const buttons = root.value?.querySelectorAll('button')
  if (buttons?.[next]) buttons[next]!.focus()
  switchBaseline(target.id)
}
</script>

<template>
  <div
    ref="root"
    class="pc-baseline-seg"
    role="radiogroup"
    :aria-label="t('baseline.switch')"
  >
    <button
      v-for="(lang, i) in languages.baselineCandidates"
      :key="lang.id"
      type="button"
      role="radio"
      :aria-checked="languages.effectiveBaseline === lang.id"
      :tabindex="languages.effectiveBaseline === lang.id ? 0 : -1"
      :title="`${lang.name} · ${t('baseline.switchHint')}`"
      @click="switchBaseline(lang.id)"
      @keydown.left.prevent="onArrow(i, -1)"
      @keydown.right.prevent="onArrow(i, 1)"
      @keydown.up.prevent="onArrow(i, -1)"
      @keydown.down.prevent="onArrow(i, 1)"
    >
      {{ lang.shortName }}
    </button>
  </div>
</template>
