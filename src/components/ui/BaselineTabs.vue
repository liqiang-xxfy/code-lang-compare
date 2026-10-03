<script setup lang="ts">
/**
 * 基准语言切换：平铺三个候选，单选。挂在左侧菜单栏顶部（SideNav），**吸顶**。
 *
 * 为什么平铺而不是折进下拉：基准不是一个可以随手切的"视角"，它是**内容维度** ——
 * 每个基准有各自的一套内容与地址（`/compare/<基准>/...`）。平铺让读者一眼看到
 * 有几个基准可选、自己现在在哪一个，不必先展开才知道。
 *
 * **与对比语言用同一种控件（`.pc-btn` chip），不再用连体分段控件。**
 * 曾经刻意分成两种语法（分段控件 = 页面本身，chip = 页内的列），想靠"实心 vs 浅色"
 * 去说明层级。实测下来那个信号太隐晦：读者看到的是两排长得不一样的东西，
 * 而两排各自是什么，仍然要靠标签去读 —— 形态没省下那句说明，只多了一种要学的样式。
 * 现在两者的区别由**位置与行为**表达，它们本来就更直接：
 *   · 位置 —— 基准在左栏顶部（全站常驻），对比语言在页内那条选择条上（只有对比页有）
 *   · 行为 —— 点基准会**跳走**（换一整套内容与地址，见 useBaselineSwitch）；
 *             点对比语言只重画当前页
 *
 * 为什么用 button + `aria-checked` 而不是原生 radio：`:checked` 是 DOM 属性，
 * 预渲染出来的 HTML 按构建期默认值写死，而返回值可能来自 localStorage ——
 * 原生 radio 会在 hydration 时被逐个修补。用属性表达选中态，与 DensityToggle /
 * ThemeToggle 保持同一形态（见 HomeView 里对 hydration 的同一约束）。
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
    class="pc-baseline-row"
    role="radiogroup"
    :aria-label="t('baseline.switch')"
  >
    <!--
      与对比语言同一套 chip 样式（`.pc-btn`）：选中态由 `aria-checked` 触发
      base.css 里那条 `[aria-checked='true']` 规则（浅色底 + 主题色描边与文字），
      与 `[aria-pressed='true']` 的对比语言共用同一条声明。
    -->
    <button
      v-for="(lang, i) in languages.baselineCandidates"
      :key="lang.id"
      type="button"
      class="pc-btn"
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

<style scoped>
/*
 * 与 `.pc-lang-bar-options`（对比语言那一排）同一条排版：4px 间距 + 允许换行。
 * 两处刻意保持一致 —— 同样的东西在两处看起来不同，本身就是一条要学的规则。
 */
.pc-baseline-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
