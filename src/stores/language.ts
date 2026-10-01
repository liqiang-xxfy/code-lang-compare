import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { usePersistedState } from '@/composables/usePersistedState'
import {
  baselineLanguageId,
  enabledLanguageIds,
  enabledLanguageMeta,
  getLanguageMeta,
  languageMeta,
} from '@/generated/registry.gen'

/** 软上限：超过 4 列时横向阅读已经吃力，UI 会提示切换基准差异模式 */
export const SOFT_COLUMN_LIMIT = 4

export const useLanguageStore = defineStore('language', () => {
  const baseline = usePersistedState<string>('lang:baseline', baselineLanguageId)
  const activeLangs = usePersistedState<string[]>('lang:active', [...enabledLanguageIds])
  /**
   * 「上次已知的已启用语言集合」——只为识别**新加入**的语言。
   *
   * 为什么需要它：`lang:active` 只存「当前选中的」，用户取消勾选与「从未见过」
   * 在存储里长得一模一样。于是新增一门语言时，老用户的偏好里不含它，
   * 清洗逻辑会把新语言过滤掉 —— 表现为「明明接了新语言，页面上却怎么也看不到」。
   * 用这个独立键做差集，才能把「新语言」与「用户主动取消的」区分开。
   */
  const knownLangs = usePersistedState<string[]>('lang:known', [])

  // 校准：持久化值可能引用了已停用的语言，也可能**缺少新加入的语言**
  const enabledSet = new Set<string>(enabledLanguageIds)
  const knownSet = new Set(knownLangs.value)
  const newlyAdded = enabledLanguageIds.filter((id) => !knownSet.has(id))

  let sanitized = activeLangs.value.filter((id) => enabledSet.has(id))
  if (newlyAdded.length) {
    // 新语言默认选中；同时保持既有顺序（按 registry 的启用顺序）
    sanitized = [...enabledLanguageIds].filter(
      (id) => sanitized.includes(id) || newlyAdded.includes(id),
    )
  }
  activeLangs.value = sanitized.length ? sanitized : [...enabledLanguageIds]
  knownLangs.value = [...enabledLanguageIds]

  if (!activeLangs.value.includes(baseline.value)) {
    baseline.value = activeLangs.value.includes(baselineLanguageId)
      ? baselineLanguageId
      : activeLangs.value[0]!
  }

  watch(activeLangs, (next) => {
    if (!next.includes(baseline.value) && next.length) baseline.value = next[0]!
  })

  const activeMeta = computed(() =>
    enabledLanguageMeta.filter((m) => activeLangs.value.includes(m.id)),
  )
  const allMeta = computed(() => languageMeta)

  /** 基准列永远排在最左（§7.3） */
  const orderedMeta = computed(() => {
    const base = activeMeta.value.find((m) => m.id === baseline.value)
    const rest = activeMeta.value.filter((m) => m.id !== baseline.value)
    return base ? [base, ...rest] : rest
  })

  const overSoftLimit = computed(() => activeLangs.value.length > SOFT_COLUMN_LIMIT)

  function toggleLanguage(id: string): void {
    if (!enabledSet.has(id)) return
    const set = new Set(activeLangs.value)
    if (set.has(id)) {
      if (set.size <= 1) return // 至少保留一列
      set.delete(id)
    } else {
      set.add(id)
    }
    activeLangs.value = [...enabledLanguageIds].filter((x) => set.has(x))
  }

  function setBaseline(id: string): void {
    if (!enabledSet.has(id)) return
    baseline.value = id
    if (!activeLangs.value.includes(id)) activeLangs.value = [...activeLangs.value, id]
  }

  function reset(): void {
    baseline.value = baselineLanguageId
    activeLangs.value = [...enabledLanguageIds]
  }

  return {
    baseline,
    activeLangs,
    activeMeta,
    allMeta,
    orderedMeta,
    overSoftLimit,
    toggleLanguage,
    setBaseline,
    reset,
    metaOf: getLanguageMeta,
  }
})
