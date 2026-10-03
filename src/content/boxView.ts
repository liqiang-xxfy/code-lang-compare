/**
 * 对比框的**双角色取值** —— 这是全站唯一一处决定「这一格该怎么读」的地方。
 *
 * 一个 RenderedBox 同时带着两套说明：`baselineHtml`（这门语言作基准列时）
 * 与 `vsHtml[基准]`（它作对比列时）。选哪一套取决于**当前页面以谁为基准**，
 * 而同一个 box 在切基准时会被重新取用 —— 不是重新加载。
 *
 * 为什么必须收敛成函数：矩阵、并排、特性页三处都要做这个判断，
 * 各写一遍的话「基准列显示成对比说明」这种错会只在其中一处出现，且不报错。
 */
import type { Equivalence, RenderedBox } from '@/schemas'

/**
 * 这一格该显示哪段说明。
 *
 * - 该语言就是当前基准 → 基础描述（它自己是什么）
 * - 否则 → 差异解释（它和当前基准差在哪）；缺这一份就是 undefined，视图留白
 */
export function explanationOf(
  box: RenderedBox,
  lang: string,
  baseline: string,
): string | undefined {
  return lang === baseline ? box.baselineHtml : box.vsHtml?.[baseline]
}

/**
 * 这一格该显示哪枚等价性徽章（`null` = 不渲染）。
 *
 * 三条规则，顺序不能换：
 *  1. **基准列不渲染** —— 它就是参照系，`=` 是自指、零信息量
 *  2. `absent` 的格子恒为 `∅` —— 必须**短路**掉 `equivalence` 的缺省值，
 *     否则「本语言无此概念」会顶着一枚 `=`（缺 key 默认 identical）
 *  3. 其余取 `equivalence[当前基准]`，缺 key 才是 inherited 的 `identical`
 */
export function badgeOf(box: RenderedBox, lang: string, baseline: string): Equivalence | null {
  if (lang === baseline) return null
  if (box.absent) return 'absent'
  return box.equivalence[baseline] ?? 'identical'
}

/** 这一格是不是「本语言无此概念」的显式声明（区别于「还没写」） */
export function isAbsentCell(box: RenderedBox | undefined): boolean {
  return box?.absent === true
}
