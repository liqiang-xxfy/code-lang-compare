/**
 * 可见列 = 基准 + 本章/本特性**真的有实现**的语言。
 *
 * 为什么需要这层裁剪：对比列是用户的多选偏好（存在 localStorage，与页面无关），
 * 而某门语言在本章有没有内容，是**内容属性**（判据是它写没写这一章引用的存放组）。
 * 两者是不同的维度：读者勾了 Go，而这一章没有 Go 的内容，页面上就会出现一整列
 * 「本模块不涉及该语言」—— 看上去像内容缺失，其实是把偏好与覆盖率混在了一起。
 *
 * 两条规则：
 *  1. 基准列无论有没有实现都保留 —— 它是页面的参照系，缺了就不叫对比了
 *  2. **一门对比语言都没有时，就只留基准列，不从别处补位**。两种情况都算：
 *     ① 读者一门都没勾（ADR-63）—— 空集合是能表达的状态，不回落成默认语言；
 *     ② 勾了的语言**一门都没被本模块覆盖**（ADR-34）。
 *     这里曾有一层兜底：从「全部已启用语言」里补上第一门有实现的当对比列，
 *     好让页面不至于退化成单列。代价是补出来的那门用户既没勾、也去不掉 ——
 *     点它是「新增」而不是「取消」，而选择条的勾选态读的是 `compareLangs`，
 *     于是页面上并列着一列没勾上的语言，看着像控件失灵。
 *
 *     覆盖面这件事不靠补位来说明：勾了却没成列，本身已经说明了这一章没有它，
 *     而**具体哪几门有**由 `CompareLanguageBar` 的置灰态回答（点了也不会有列）。
 */
import type { LanguageMeta } from '@/schemas'

export function pickColumns(
  ordered: LanguageMeta[],
  baseline: string,
  present: ReadonlySet<string>,
): LanguageMeta[] {
  const base = ordered.find((m) => m.id === baseline)
  const picked = ordered.filter((m) => m.id !== baseline && present.has(m.id))
  return base ? [base, ...picked] : picked
}
