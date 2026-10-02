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
 *  2. 勾选的语言**一门都没被本模块覆盖时，就只留基准列，不从别处补位**（ADR-34）。
 *     这里曾有一层兜底：从「全部已启用语言」里补上第一门有实现的当对比列，
 *     好让页面不至于退化成单列。代价是补出来的那门用户既没勾、也去不掉 ——
 *     点它是「新增」而不是「取消」，而选择条的勾选态读的是 `compareLangs`，
 *     于是页面上并列着一列没勾上的语言，看着像控件失灵。
 *
 *     `concepts-java` 让这层兜底**必现**：它只覆盖 js / java，而默认对比语言是
 *     python —— 保持默认的人只要以 Java 为基准进心智模型，就一定会看到一列
 *     自己没勾的 JavaScript。覆盖面的实情本来就由 CompareSurface 的
 *     `sections.scopeHint` 说清楚（「本模块目前只对照 X、Y」），
 *     不需要再拿一门用户没要的语言把版面填满。
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
