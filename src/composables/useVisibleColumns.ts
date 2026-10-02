/**
 * 可见列 = 基准 + 本章/本特性**真的有实现**的语言。
 *
 * 为什么需要这层裁剪：对比列是用户的多选偏好（存在 localStorage，与页面无关），
 * 而 topic 的覆盖范围是内容属性（`topic.languages`）。骨架期 Python / Java 基准的
 * 基础语法只覆盖两门语言，用户若勾了 Go，页面上就会出现一整列「本模块不涉及该语言」——
 * 看上去像内容缺失，实际是把两个不同维度的东西混在了一起。
 *
 * 两条规则：
 *  1. 基准列无论有没有实现都保留 —— 它是页面的参照系，缺了就不叫对比了
 *  2. 用户勾的语言一个都没被本模块覆盖时，**补上第一个被覆盖的语言** ——
 *     否则页面会退化成「只有基准一列」，看起来像功能坏了
 */
import { enabledLanguageMeta } from '@/generated/registry.gen'
import type { LanguageMeta } from '@/schemas'

export function pickColumns(
  ordered: LanguageMeta[],
  baseline: string,
  present: ReadonlySet<string>,
): LanguageMeta[] {
  const base = ordered.find((m) => m.id === baseline)
  const picked = ordered.filter((m) => m.id !== baseline && present.has(m.id))
  if (picked.length) return base ? [base, ...picked] : picked

  const fallback = enabledLanguageMeta.find((m) => m.id !== baseline && present.has(m.id))
  if (base) return fallback ? [base, fallback] : [base]
  return fallback ? [fallback] : []
}
