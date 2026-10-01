/**
 * 持久化设置 —— 统一封装（ADR-17）
 *
 *  · 命名空间前缀 pc: ，避免与同域其它应用撞 key
 *  · 带版本号；版本不兼容时**直接丢弃旧值**而不是写迁移代码
 *    （单用户工具，迁移成本 > 收益；这条明确写死，避免以后纠结）
 *  · localStorage 不可用（隐私模式 / SSR）时静默降级为内存态
 *
 * ── 为什么还要 `allowed` 守卫 ──────────────────────────────────
 * 底层 useLocalStorage 的**编码方式取决于默认值的类型**：字符串按原文读写，
 * 数组/对象走 JSON，布尔按 'true'/'false'。这带来一个真实的静默失败：
 * 只要某次写入了不符合该编码的值（手工改过、旧版本遗留、外部工具写入），
 * 读回来的就是那个非法值 —— 界面上表现为「分段控件里一个选项都没高亮」，
 * 而且不报任何错。实测就踩到过（写入 '"comfortable"' 后，两个密度按钮都不选中）。
 *
 * 所以枚举型设置一律传 `allowed`：不在集合里就回退默认值，并在控制台留一条提示。
 */
import { watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import type { Ref } from 'vue'

export const PERSIST_NAMESPACE = 'pc'
export const PERSIST_VERSION = 'v1'

let versionChecked = false

function ensureStorageVersion(): void {
  if (versionChecked || typeof window === 'undefined') return
  versionChecked = true
  const versionKey = `${PERSIST_NAMESPACE}:v`
  try {
    if (window.localStorage.getItem(versionKey) !== PERSIST_VERSION) {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(`${PERSIST_NAMESPACE}:`)) window.localStorage.removeItem(key)
      }
      window.localStorage.setItem(versionKey, PERSIST_VERSION)
    }
  } catch {
    // 忽略：隐私模式下 localStorage 会抛错，降级为内存态即可
  }
}

export interface PersistedOptions<T> {
  /** 枚举型设置的合法取值；不在其中则回退默认值 */
  allowed?: readonly T[]
}

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options: PersistedOptions<T> = {},
): Ref<T> {
  ensureStorageVersion()
  const storageKey = `${PERSIST_NAMESPACE}:${PERSIST_VERSION}:${key}`
  const state = useLocalStorage<T>(storageKey, defaultValue, { mergeDefaults: true }) as Ref<T>

  const { allowed } = options
  if (allowed?.length) {
    const isValid = (value: unknown): value is T => allowed.includes(value as T)
    if (!isValid(state.value)) {
      console.warn(
        `[persist] ${storageKey} 的值不合法（${JSON.stringify(state.value)}），已回退为默认值。` +
          `合法取值：${allowed.map((v) => JSON.stringify(v)).join(' / ')}`,
      )
      state.value = defaultValue
    }
    watch(state, (value) => {
      if (!isValid(value) && value !== defaultValue) state.value = defaultValue
    })
  }

  return state
}
