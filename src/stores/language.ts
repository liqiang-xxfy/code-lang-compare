import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { usePersistedState } from '@/composables/usePersistedState'
import { resolvePairTarget, sectionUsesTarget } from '@/content/repository'
import type { Section } from '@/schemas'
import {
  baselineLanguageIds,
  defaultBaselineLanguageId,
  defaultCompareLanguageId,
  enabledLanguageIds,
  enabledLanguageMeta,
  getLanguageMeta,
  languageMeta,
} from '@/generated/registry.gen'

/** 软上限：超过 4 列时横向阅读已经吃力，UI 会提示切换基准差异模式 */
export const SOFT_COLUMN_LIMIT = 4

/**
 * 语言选择状态。
 *
 * P7 之后「基准」不再是一个可以随手切换的本地状态，而是**内容维度**：
 * 三套内容各有一个 URL（`/compare/<基准>/...`），所以
 *
 *   · **基准以路由参数为准**（`routeBaseline`），localStorage 只记「上次选的是谁」，
 *     用于首页入口、`/search`、`/attributions` 这些没有基准的路由
 *   · **对比语言仍存本地**（默认 `defaultCompareLanguage`），它是个人偏好而不是内容维度 ——
 *     把它写进 URL 会让组合数从 3 涨到 3×15
 *   · 基础语法用**多选**（`compareLangs`）；对级板块（迁移教程/陷阱/词典/路线）
 *     用**单选**（`preferredTarget`），列锁定为 `[基准, 目标]`，不跟多选走
 *
 * 两个选择控件并排挂在每个板块页内的选择条上（CompareLanguageBar）：基准是
 * 连体分段控件（BaselineTabs），对比语言是各自独立的 chip。形态与行为都不同 ——
 * **切换基准走导航**（换基准 = 换一整套内容与地址），切换对比语言只改本地状态、
 * 只重画当前页（地址里没有它，ADR-26 / ADR-27）。
 */
export const useLanguageStore = defineStore('language', () => {
  const lastBaseline = usePersistedState<string>('lang:baseline', defaultBaselineLanguageId)
  const compareLangs = usePersistedState<string[]>('lang:compare', [defaultCompareLanguageId])
  /**
   * 「上次已知的已启用语言集合」——只为识别**新加入**的语言。
   *
   * 为什么需要它：`lang:compare` 只存「当前选中的」，用户取消勾选与「从未见过」
   * 在存储里长得一模一样。于是新增一门语言时，老用户的偏好里不含它，
   * 清洗逻辑会把新语言过滤掉 —— 表现为「明明接了新语言，页面上却怎么也看不到」。
   */
  const knownLangs = usePersistedState<string[]>('lang:known', [])

  const enabledSet = new Set<string>(enabledLanguageIds)
  /** 「已启用」与「有资格当基准」是两件事：一门语言可以参与对比却不适合当参照系 */
  const candidateSet = new Set<string>(baselineLanguageIds)

  /*
   * 只有「有上一次记录」时才谈得上"新加入的语言"。
   * knownLangs 为空 = 首次访问 —— 此时把默认值当成「用户全都没见过」会把
   * 默认的一门对比语言扩成五门，首访页面直接爆成一排列。
   */
  const knownSet = new Set(knownLangs.value)
  const newlyAdded = knownSet.size
    ? enabledLanguageIds.filter((id) => !knownSet.has(id) && id !== lastBaseline.value)
    : []
  let sanitized = compareLangs.value.filter((id) => enabledSet.has(id))
  if (newlyAdded.length) {
    sanitized = [...enabledLanguageIds].filter(
      (id) => sanitized.includes(id) || newlyAdded.includes(id),
    )
  }
  if (!sanitized.length) sanitized = [defaultCompareLanguageId]
  compareLangs.value = sanitized
  knownLangs.value = [...enabledLanguageIds]

  if (!enabledSet.has(lastBaseline.value) || !candidateSet.has(lastBaseline.value)) {
    lastBaseline.value = defaultBaselineLanguageId
  }

  /** 由 App.vue 的路由 watcher 写入；不在 /compare/* 下时分别为 null */
  const routeBaseline = ref<string | null>(null)
  const routeSection = ref<Section | null>(null)
  /**
   * 用户最近一次主动挑的对比语言。
   *
   * 对级板块的目标不进 URL，得有个东西回答"现在该看哪个方向"。
   * 光看 compareLangs 的顺序不行 —— 那是按 registry 排的（go 排在 python 前面），
   * 用户刚勾的 Go 会被排在后面的 Python 顶掉。
   */
  const preferredTarget = usePersistedState<string>('lang:target', '')

  const effectiveBaseline = computed(() => {
    const fromRoute = routeBaseline.value
    if (fromRoute && enabledSet.has(fromRoute) && candidateSet.has(fromRoute)) return fromRoute
    if (enabledSet.has(lastBaseline.value) && candidateSet.has(lastBaseline.value)) {
      return lastBaseline.value
    }
    return baselineLanguageIds[0] ?? enabledLanguageIds[0]!
  })

  /** 多选出来的对比语言（已去掉基准自身与停用语言） */
  const compareMeta = computed(() => {
    const base = effectiveBaseline.value
    const picked = compareLangs.value.filter((id) => enabledSet.has(id) && id !== base)
    if (picked.length) return enabledLanguageMeta.filter((m) => picked.includes(m.id))
    // 一门都没选（或选的全是基准自己）时回落到第一门非基准语言，保证至少有对比列
    const fallback = enabledLanguageIds.find((id) => id !== base)
    return fallback ? enabledLanguageMeta.filter((m) => m.id === fallback) : []
  })

  /**
   * 对级板块当前生效的目标语言（基础语法下为 null）。
   *
   * 这是"目标不进 URL"之后唯一需要额外推导的东西 —— 规则集中在
   * repository.resolvePairTarget，那里有它为什么这么排优先级的说明。
   */
  /**
   * 某个板块当前生效的目标语言。
   *
   * `baseline` 可以显式传入 —— **路由守卫必须传**，因为守卫跑在 App 的
   * 路由 watcher 之前，那时 `routeBaseline` 还是 null，`effectiveBaseline` 会落到
   * 「上次选择」上。用错了基准就会去加载另一套分片，页面渲染时缓存里没有，
   * 表现为一整页空白（而不是报错）。
   */
  const resolveTargetFor = (
    section: Section,
    baseline: string = effectiveBaseline.value,
  ): string | null =>
    // 「有没有方向」由板块的 scope 决定，与「几列」（columns）是两回事
    sectionUsesTarget(section)
      ? resolvePairTarget(baseline, section, compareLangs.value, preferredTarget.value)
      : null

  const pairTarget = computed(() =>
    routeSection.value ? resolveTargetFor(routeSection.value) : null,
  )

  /** 基准列永远排在最左（§7.3）；对级板块的列锁定为 [基准, 目标] */
  const orderedMeta = computed(() => {
    const base = enabledLanguageMeta.find((m) => m.id === effectiveBaseline.value)
    const target = pairTarget.value
    if (target) {
      const other = enabledLanguageMeta.find((m) => m.id === target && m.id !== base?.id)
      return base ? (other ? [base, other] : [base]) : other ? [other] : []
    }
    return base ? [base, ...compareMeta.value] : compareMeta.value
  })

  const overSoftLimit = computed(() => orderedMeta.value.length > SOFT_COLUMN_LIMIT)
  const baselineCandidates = computed(() =>
    enabledLanguageMeta.filter((m) => candidateSet.has(m.id)),
  )
  /** 对级板块下不允许在页内切列 —— 列由目标语言决定，换列等于换一篇文章 */
  const isPairMode = computed(() => pairTarget.value !== null)

  /**
   * 保证「勾选集合」里至少有一门非基准语言。
   *
   * 为什么需要：`compareMeta` 在一门非基准语言都没勾时会**回落**到第一门非基准
   * 语言，但那一门并不在 `compareLangs` 里。界面若照 `compareMeta` 渲染勾选态，
   * 就会把一门用户没勾的语言显示成已勾选 —— 他去取消它，`toggleCompare` 走的是
   * else 分支，**看着是取消、实际是新增**。把回落值写回存储，两者就恒等了。
   */
  function ensureCompareColumn(): void {
    const base = effectiveBaseline.value
    if (compareLangs.value.some((id) => enabledSet.has(id) && id !== base)) return
    const fallback = enabledLanguageIds.find((id) => id !== base)
    if (fallback) {
      compareLangs.value = [...enabledLanguageIds].filter(
        (x) => compareLangs.value.includes(x) || x === fallback,
      )
    }
  }

  function setRouteContext(baseline: string | null, section: Section | null): void {
    routeBaseline.value = baseline
    routeSection.value = section
    /*
     * 只在**对比板块**里归一化。
     *
     * 没有板块的页面（首页 / 速查 / 内容来源）根本没有"对比列"这回事，而那里
     * `effectiveBaseline` 会落到 localStorage 的「上次选择」上 —— 在那里补一列
     * 等于趁用户看首页时悄悄改掉他的勾选集合。
     */
    if (section) ensureCompareColumn()
  }

  /**
   * 精确指定要看哪个方向（搜索结果点击、深链进入时用）。
   *
   * 把目标**并进**已勾选的集合而不是替换 —— 用户可能正拿着 [python, go] 两列
   * 在看基础语法，点一条 Go 的陷阱不该把 Python 悄悄取消掉。
   *
   * 页内选择条请用 `setPairTarget`：它只管方向，不动基础语法的对比列。
   */
  function preferTarget(id: string): void {
    if (!enabledSet.has(id)) return
    preferredTarget.value = id
    if (!compareLangs.value.includes(id)) {
      compareLangs.value = [...enabledLanguageIds].filter(
        (x) => compareLangs.value.includes(x) || x === id,
      )
    }
  }

  /**
   * 页内选择条选方向（对级四板块）。
   *
   * 与 `preferTarget` 的唯一区别：**不并进 `compareLangs`**。方向选择条只回答
   * "我现在想看哪个方向"，不该顺手改动用户在基础语法里挑的那几列。
   */
  function setPairTarget(id: string): void {
    if (!enabledSet.has(id)) return
    preferredTarget.value = id
  }

  /** 只记「上次选择」用于无基准路由，**不改 URL** —— 导航由调用方（视图）负责 */
  function rememberBaseline(id: string): void {
    if (candidateSet.has(id)) lastBaseline.value = id
  }

  function toggleCompare(id: string): void {
    if (!enabledSet.has(id) || id === effectiveBaseline.value) return
    const set = new Set(compareLangs.value)
    if (set.has(id)) {
      if (set.size <= 1) return // 至少保留一列
      set.delete(id)
      if (preferredTarget.value === id) preferredTarget.value = ''
    } else {
      set.add(id)
      // 刚勾上的这门就是对级板块该显示的方向 —— 否则"勾了 Go 页面没反应"
      preferredTarget.value = id
    }
    compareLangs.value = [...enabledLanguageIds].filter((x) => set.has(x))
  }

  function setBaselinePreference(id: string): void {
    if (!candidateSet.has(id)) return
    lastBaseline.value = id
  }

  function reset(): void {
    lastBaseline.value = defaultBaselineLanguageId
    compareLangs.value = [defaultCompareLanguageId]
    preferredTarget.value = ''
  }

  return {
    /** @deprecated 可写版本已移除；请用 effectiveBaseline / setRouteContext */
    baseline: effectiveBaseline,
    effectiveBaseline,
    routeBaseline,
    routeSection,
    pairTarget,
    /** 用户最近主动挑的方向；页内选择条据此渲染「本板块暂无 X」的回落提示 */
    preferredTarget,
    isPairMode,
    /** 基础语法的**勾选集合**（区别于 compareMeta：那个含回落，见 ensureCompareColumn） */
    compareLangs,
    compareMeta,
    orderedMeta,
    allMeta: computed(() => languageMeta),
    enabledMeta: enabledLanguageMeta,
    baselineCandidates,
    overSoftLimit,
    setRouteContext,
    rememberBaseline,
    setBaselinePreference,
    preferTarget,
    setPairTarget,
    resolveTargetFor,
    toggleCompare,
    reset,
    metaOf: getLanguageMeta,
  }
})
