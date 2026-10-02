<script setup lang="ts">
/**
 * 页内的语言选择条（五个板块各挂一支）：**基准 + 对比语言**两组。
 *
 * 为什么从顶栏下沉到页内：基础语法与对级四板块对"对比语言"的语义**完全不同** ——
 * 前者是「基准 + 多选」的并排对照，后者是「一门目标 = 一篇文章」。同一个 checkbox
 * 列表在两种页面下含义不同，放在顶栏时只能靠一句说明去解释；放到页内之后，
 * 控件形态本身（多选框 vs 单选）就是那句说明。
 *
 * 基准后来也从顶栏搬到了这里（它原先在顶栏常驻）。理由：两组控件调的是
 * **同一件事的两个层级** —— 拿谁当参照系、再拿谁跟它比；分居顶栏与页内时，
 * 读者得在两处来回看才能确认「我现在是以谁为基准在看谁」。并排之后，
 * 谁变谁不变一目了然。
 * 代价是首页 / 速查 / 内容来源这三页不再有基准入口 —— 那三页没有对比列，
 * 切了也看不出变化（速查页的 scopeNote 本来就是让人回对比页切基准的口径）。
 *
 * **不产生导航**：目标语言不进 URL（ADR-26 / ADR-27），选中只改本地状态，
 * 视图按需重新装载对应分片（见 usePairPayload 的文件头注释）。
 *
 * `section` 由调用方以 prop 传入而不是读 `routeSection` —— 后者由 App.vue 的
 * 路由 watcher 写入，用它会把选中态绑到那个时序上；显式传参则与路由守卫同一口径。
 */
import { useElementSize } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import BaselineTabs from '@/components/ui/BaselineTabs.vue'
import { useI18n } from '@/composables/useI18n'
import { pairTargetsOf, sectionIsMulti, sectionUsesTarget } from '@/content/repository'
import { enabledLanguageMeta } from '@/generated/registry.gen'
import { useLanguageStore } from '@/stores/language'
import type { Section } from '@/schemas'

const props = defineProps<{ section: Section }>()
const languages = useLanguageStore()
const { t } = useI18n()

/** 控件形态由板块注册表的 `columns` 决定：多选 = 多列并排，单选 = 一篇文章 */
const isMulti = computed(() => sectionIsMulti(props.section))

/**
 * 该板块有没有「方向」概念 —— 由 `scope` 决定，**与控件形态是两回事**。
 *
 * 两者曾共用一个 `section === 'basics'` 判断，于是「基准级 + 单选」这类板块
 * 会被错误地送进 pairTargetsOf，拿到一份没有意义的方向列表。
 */
const hasTarget = computed(() => sectionUsesTarget(props.section))

const baseline = computed(() => languages.effectiveBaseline)

/**
 * 候选 = 全部已启用语言去掉基准。缺内容的方向**也要列出来**，只是置灰 ——
 * 直接藏掉的话，读者会以为这门语言压根不支持对比。
 */
const options = computed(() => enabledLanguageMeta.filter((m) => m.id !== baseline.value))

/** 本板块真的有内容的方向。基准级板块没有「方向」这个概念，故为 null */
const available = computed(() =>
  hasTarget.value ? new Set(pairTargetsOf(baseline.value, props.section)) : null,
)

/** 单选模式下当前生效的方向；推导口径与路由守卫一致 */
const currentTarget = computed(() =>
  hasTarget.value ? languages.resolveTargetFor(props.section) : null,
)

const isChecked = (id: string): boolean =>
  isMulti.value ? languages.compareLangs.includes(id) : currentTarget.value === id

const isDisabled = (id: string): boolean => available.value !== null && !available.value.has(id)

/** 一律用 click 而不是 change：点击已选中项也要落盘（见下方 fallbackNote） */
function pick(id: string): void {
  if (isMulti.value) languages.toggleCompare(id)
  else languages.setPairTarget(id)
}

function nameOf(id: string): string {
  return languages.metaOf(id)?.name ?? id
}

/**
 * 用户最近想看的方向在本板块没有内容时的说明。
 *
 * `resolvePairTarget` 会回落到本板块可用的第一条，于是选中态看起来"不是他挑的那门"。
 * 刻意**不覆写** `preferredTarget` —— 它记的是"最近想看的那门"，回到有该方向的
 * 板块时应当恢复，而不是被这一页悄悄改掉。用一句说明交代清楚，比替他改掉更诚实。
 */
const fallbackNote = computed(() => {
  if (isMulti.value || !currentTarget.value) return ''
  const want = languages.preferredTarget
  if (!want || want === currentTarget.value) return ''
  if (available.value?.has(want)) return ''
  return t('compareBar.fallback', { requested: nameOf(want), actual: nameOf(currentTarget.value) })
})

const modeHint = computed(() => t(isMulti.value ? 'compareBar.multiHint' : 'compareBar.singleHint'))

/**
 * 把本条的实测高度写进 --pc-lang-bar-h，供矩阵表头算吸附位置。
 *
 * 两者都是 sticky 的，而本条 z-index 更高：表头的吸附位置必须落在本条下沿，
 * 否则会被整条盖住，长表格往下翻就看不到列名。本条在窗口变窄、说明文案变长时
 * 都会折行，高度不是常数 —— 在 CSS 里估一个值迟早会对不上，所以实测。
 * 写成 CSS 变量而不是行内样式，是因为读它的是 base.css 里的表头规则。
 * 高度为 0 时不写（预渲染环境没有布局，写进去会往 HTML 里留一个 0 的假值）。
 */
const barEl = ref<HTMLElement | null>(null)
/* 必须取 border-box：默认的 content-box 不含 padding 与边框，比实际矮 18px，
   表头会有一截钻到选择条底下。 */
const { height: barHeight } = useElementSize(barEl, { width: 0, height: 0 }, { box: 'border-box' })

watchEffect(() => {
  if (!barHeight.value) return
  /* 向上取整：宁可留一根发丝的空隙，也不要盖住表头那一行。 */
  document.documentElement.style.setProperty('--pc-lang-bar-h', `${Math.ceil(barHeight.value)}px`)
})

onBeforeUnmount(() => {
  document.documentElement.style.removeProperty('--pc-lang-bar-h')
})
</script>

<template>
  <div ref="barEl" class="pc-lang-bar">
    <!--
      两组控件形态不同，是刻意的：基准是「页面本身」（连体分段控件 + 切换即导航），
      对比语言是「页内看到的列」（各自独立的 chip + 只重画当前页）。理由见文件头注释。
    -->
    <div class="pc-lang-group">
      <span class="pc-lang-bar-label">{{ t('baseline.label') }}</span>
      <BaselineTabs />
    </div>

    <div class="pc-lang-group">
      <span class="pc-lang-bar-label">{{ t('compareBar.groupLabel') }}</span>
      <div
        class="pc-lang-bar-options"
        :role="isMulti ? 'group' : 'radiogroup'"
        :aria-label="t('compareBar.groupLabel')"
      >
        <button
          v-for="lang in options"
          :key="lang.id"
          type="button"
          class="pc-btn"
          :role="isMulti ? undefined : 'radio'"
          :aria-pressed="isMulti ? isChecked(lang.id) : undefined"
          :aria-checked="isMulti ? undefined : isChecked(lang.id)"
          :disabled="isDisabled(lang.id)"
          :title="isDisabled(lang.id) ? t('compareBar.unavailable') : lang.name"
          @click="pick(lang.id)"
        >
          {{ lang.shortName }}
        </button>
      </div>
    </div>

    <p class="pc-hint pc-lang-bar-note">
      {{ fallbackNote || modeHint }}
    </p>
  </div>
</template>

<style scoped>
/*
 * 吸附在内容区顶部。z-index 夹在矩阵表头（3/5）与顶栏（30）之间：
 * 低于顶栏才不会盖住导航，高于表头才不会读长章节时被表格头压住。
 */
.pc-lang-bar {
  position: sticky;
  top: var(--pc-header-h);
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  /* 列间距大于行间距：换行时同一组不会被拆得看不清边界 */
  gap: 8px 18px;
  margin-bottom: var(--pc-pad-lg);
  padding: 8px 12px;
  background: var(--pc-bg-elev);
  border: 1px solid var(--pc-border);
  border-radius: var(--pc-radius);
}
/* 一组 = 标签 + 控件。组内 8px、组间 18px（见 .pc-lang-bar 的 gap），
   让「基准语言」「对比语言」两件事在视觉上先分组、再读细节 */
.pc-lang-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pc-lang-bar-label {
  font-size: var(--pc-fs-xs);
  font-weight: 600;
  color: var(--pc-text-mute);
  white-space: nowrap;
}
.pc-lang-bar-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pc-lang-bar-note {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
</style>
