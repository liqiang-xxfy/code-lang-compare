<script setup lang="ts">
/**
 * 页内的对比语言选择条（五个板块各挂一支）。
 *
 * 为什么对比语言在页内、基准在左栏顶部：两者回答的是不同层级的问题 ——
 * 对比语言是**页内看到的列**（只重画当前页、不进地址），基准是**页面本身**
 * 的参照系（换它 = 换一整套内容与地址），而首页 / 速查 / 内容来源这些
 * 没有对比列的页面同样需要后者。
 *
 * **两处用的是同一种 chip 控件**（`.pc-btn`），区别由位置与行为表达：
 * 基准在左栏顶部、全站常驻，点它会跳走；对比语言在本条里、只有对比页有，
 * 点它只重画当前页。曾经刻意用两种控件语法去区分层级，实测那个信号太隐晦
 * （见 BaselineTabs 的文件头注释）。
 *
 * 对比语言在这里还有第二重语义：多选（多列并排）还是单选（一篇文章），
 * 由板块注册表的 `columns` 决定，勾选框 / 单选框本身就是那句说明。
 *
 * 形态分工：章节型板块是「基准 + 多选并排」，速查三兄弟是「一门目标 = 一篇文章」。
 *
 * **不产生导航**：对比语言不进 URL（ADR-26 / ADR-27），选中只改本地状态，
 * 视图按需重新装载对应分片（见 usePairPayload 的文件头注释）。
 *
 * `section` 由调用方以 prop 传入而不是读 `routeSection` —— 后者由 App.vue 的
 * 路由 watcher 写入，用它会把选中态绑到那个时序上；显式传参则与路由守卫同一口径。
 */
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useI18n } from '@/composables/useI18n'
import { pairTargetsOf, sectionIsChapter, sectionIsMulti, sectionUsesTarget } from '@/content/repository'
import { enabledLanguageMeta } from '@/generated/registry.gen'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'
import type { ViewMode } from '@/stores/ui'
import type { Section } from '@/schemas'

const props = defineProps<{
  section: Section
  /**
   * 本页真正有内容的语言集合。章节型板块由视图按**本章**算好传进来
   * （判据 `hasChapterContent`，与列裁剪、与路由同源）；不传 = 无从判断，
   * 则只有基准那一项置灰。
   *
   * 传进来的意义是**提前告诉用户点了不会有列**：原先缺内容的方向也能点，
   * 点完页面毫无反应，看起来像控件坏了。
   */
  available?: ReadonlySet<string> | null
}>()

const languages = useLanguageStore()
const ui = useUiStore()
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

/**
 * 展示方式只对**章节型**板块有意义（它切的是矩阵 / 卡片并排两种排法），
 * 速查三兄弟是一篇一篇文章，没有「排法」可切。
 */
const showViewMode = computed(() => sectionIsChapter(props.section))

const viewModes = computed<Array<{ value: ViewMode; label: string }>>(() => [
  { value: 'matrix', label: t('viewMode.matrix') },
  { value: 'side-by-side', label: t('viewMode.sideBySide') },
])

const baseline = computed(() => languages.effectiveBaseline)

/**
 * 候选 = **全部已启用语言**，按 registry 的声明序（JS / Python / Java / Go / Rust）。
 *
 * 当前基准与缺内容的语言都**留在列表里、只是置灰**：前者直接藏掉的话，
 * 读者会以为这门语言「不在对比里」（而它正是页面的参照系，就在最左边那一列）；
 * 后者藏掉的话，会以为这门语言压根不支持对比，而不是「本模块还没写」。
 * 灰色 + title 说明，比消失更能回答问题。
 */
const options = computed(() => enabledLanguageMeta)

/** 本板块真的有内容的方向。基准级板块没有「方向」这个概念，故为 null */
const internalAvailable = computed(() =>
  hasTarget.value ? new Set(pairTargetsOf(baseline.value, props.section)) : null,
)
const available = computed<ReadonlySet<string> | null>(
  () => props.available ?? internalAvailable.value,
)

/** 单选模式下当前生效的方向；推导口径与路由守卫一致 */
const currentTarget = computed(() =>
  hasTarget.value ? languages.resolveTargetFor(props.section) : null,
)

const isBaseline = (id: string): boolean => id === baseline.value

/**
 * 选中态。**基准那一项恒为未选中**，即便它还在 `compareLangs` 里 ——
 * 用户把基准切成某门已勾选的语言时，勾选集合里仍留着它（不动用户的选择是对的），
 * 但它此刻的身份是基准列，不是对比列。不排除的话，那一格会同时是
 * 「按下」与「禁用」两种样子。
 */
const isChecked = (id: string): boolean =>
  isMulti.value
    ? !isBaseline(id) && languages.compareLangs.includes(id)
    : currentTarget.value === id

const isDisabled = (id: string): boolean =>
  isBaseline(id) || (available.value !== null && !available.value.has(id))

/** 灰显项的 title：两种灰的理由不同，说清楚是哪一种 */
function disabledHint(id: string): string {
  return isBaseline(id)
    ? t('compareBar.isBaseline', { name: nameOf(id) })
    : t('compareBar.unavailable')
}

/** 一律用 click 而不是 change：点击已选中项也要落盘（见下方 fallbackNote） */
function pick(id: string): void {
  if (isDisabled(id)) return
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
 * 把本条的实测高度写进 --pc-lang-bar-h，供 `.pc-anchored` 算锚点跳转的
 * `scroll-margin-top` —— 跳过去时标题不能被这条吸顶的条盖住。
 *
 * 量的是**外层**（含与顶栏之间那 8px 间隙），不是方框：读者看到的下沿是整条的下沿，
 * 而本条的下内边距是 0，所以两者正好重合。本条在窗口变窄、说明文案变长时都会折行，
 * 高度不是常数 —— 在 CSS 里估一个值迟早会对不上，所以实测。
 * 写成 CSS 变量而不是行内样式，是因为读它的是 base.css 里的规则。
 * 高度为 0 时不写（预渲染环境没有布局，写进去会往 HTML 里留一个 0 的假值）。
 */
const barEl = ref<HTMLElement | null>(null)
/* 必须取 border-box：默认的 content-box 不含 padding 与边框，比实际矮 18px，
   锚点跳过去的标题会有一截钻到选择条底下。 */
const { height: barHeight } = useElementSize(barEl, { width: 0, height: 0 }, { box: 'border-box' })

watchEffect(() => {
  if (!barHeight.value) return
  /* 向上取整：宁可留一根发丝的空隙，也不要盖住跳转过去的那个标题。 */
  document.documentElement.style.setProperty('--pc-lang-bar-h', `${Math.ceil(barHeight.value)}px`)
})

onBeforeUnmount(() => {
  document.documentElement.style.removeProperty('--pc-lang-bar-h')
})
</script>

<template>
  <!--
    两层：外层负责吸顶、留出与顶栏之间的间隙、挡底；内层是那个方框。
    为什么必须分开 —— 间隙要留在**方框之外**，而 border / 背景 / 圆角都在方框上，
    合在一层的话那 8px 会落进边框里，看起来只是内边距变大。
  -->
  <div ref="barEl" class="pc-lang-bar">
    <div class="pc-lang-bar-box">
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
            :title="isDisabled(lang.id) ? disabledHint(lang.id) : lang.name"
            @click="pick(lang.id)"
          >
            {{ lang.shortName }}
          </button>
        </div>
      </div>

      <p class="pc-hint pc-lang-bar-note">
        {{ fallbackNote || modeHint }}
      </p>

      <!--
        展示方式与对比语言**同级、靠右**：两者都是"这一页怎么摆"，不是"看哪门语言"。
        放在同一条里就不必在页面里再找一次开关，切换也不引起滚动位置跳动。
      -->
      <div v-if="showViewMode" class="pc-seg" role="group" :aria-label="t('viewMode.label')">
        <button
          v-for="mode in viewModes"
          :key="mode.value"
          type="button"
          :aria-pressed="ui.viewMode === mode.value"
          @click="ui.viewMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 吸附在内容区顶部。z-index（20）低于顶栏（30）才不会盖住导航 —— 矩阵表头不吸顶
 * （见 base.css 的 `table.pc-matrix thead th`），两者不会再碰面。
 *
 * 本身**不带边框与圆角**，只做三件事：吸顶、挡底、给方框留出上下的呼吸位 ——
 * 外观全在里面的 `.pc-lang-bar-box` 上。间隙必须留在方框**之外**：合在一层的话
 * 那几 px 会落进边框里，看起来只是内边距变大，而不是"离顶有段距离"。
 *
 * 上间隙取 `--pc-sticky-gap`，与左栏那个基准选择框**同值** —— 两侧各留同样一截，
 * 两个方框的上沿才会落在同一水平线上。这是硬契约，改就得两处一起改。
 *
 * 下间隙只作用于页内这条（把方框与底下的表格 / 正文分开），**不参与**那条对齐，
 * 所以可以单独调 —— 它只影响 `--pc-lang-bar-h` 的量值，也就是锚点跳转的落点。
 *
 * 底色必须不透明且与正文同色（`--pc-bg`）：这层比方框高一截，
 * 滚上去的标题会从那两截间隙里透出来 —— 那就成了"没吸住"的样子。
 */
.pc-lang-bar {
  position: sticky;
  top: var(--pc-header-h);
  z-index: 20;
  padding: var(--pc-sticky-gap) 0 3px;
  background: var(--pc-bg);
  margin-bottom: var(--pc-pad-lg);
}
/*
 * 方框 —— 与左栏的 `.pc-side-baseline-box` 同一套外观（抬升底 + 1px 边框 + 圆角）。
 *
 * 纵向 6px 是"与左栏那个基准语言框平齐"的契约值 —— 两个吸顶件都以
 * `.pc-btn` chip 为最矮内容，同样的纵向 padding 才会得到同样的高度
 * （6+29.6+6+2 = 43.6px）。改这里就得同时改 `.pc-side-baseline-box` 的，
 * 否则右边会比左边高一截（此前是 8px，实测右 48px / 左 43.6px）。
 * 左栏收起、窄屏（左栏不在同一条水平线上）时这个平齐无从谈起，但代价为零。
 */
.pc-lang-bar-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  /* 列间距大于行间距：换行时同一组不会被拆得看不清边界 */
  gap: 8px 18px;
  padding: 6px 12px;
  background: var(--pc-bg-elev);
  border: 1px solid var(--pc-border);
  border-radius: var(--pc-radius);
}
/* 一组 = 标签 + 控件。组内 8px、组间 18px（见 .pc-lang-bar 的 gap），
   让「标签」与「选项」在视觉上先分组、再读细节 */
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
/* flex:1 把右侧的展示方式推到最右；本条不折行时它们不会贴在一起 */
.pc-lang-bar-note {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
</style>
