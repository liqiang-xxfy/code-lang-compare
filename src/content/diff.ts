/**
 * 行级差异计算（运行时）。
 *
 * 为什么放在运行时而不是构建期（ADR-05）：
 *  · 基准语言由用户在 7 门中任选 → 构建期要预计算 7×6 = 42 组两两对比
 *  · 「只看差异」「展开行」「切展示模式」都会改变实际渲染集合
 * jsdiff 体积很小，按需算一次再缓存足够快。
 *
 * 为什么用 diffArrays 而不是 diffLines：
 *   diffLines 的输出会把相邻的「删除 + 新增」合并成一个较大的块。实测下面这段
 *     base   = ['line1','line2','line3']
 *     target = ['line1','LINE2','line3','line4']
 *   会被合并成「删除 line2/line3」+「新增 LINE2/line3/line4」，
 *   结果本来完全相同的 line3 也被标成「不同」—— 这会让用户不再信任差异着色。
 *   按行数组做 diff，索引与行号严格 1:1，只标真正不同的那一行。
 *
 * 注意：这里**不产出「相似度百分比」**。跨语言（JS vs Python）的差异比例恒在低区间，
 * 没有任何区分度，是个伪精度指标。UI 上只展示「有 N 行不同」这类事实。
 */
import { diffArrays } from 'diff'

export interface LineDiff {
  /** 目标语言里「新增」的行号（1-based） */
  added: Set<number>
  /** 目标语言里「被替换」的行号（1-based） */
  changed: Set<number>
  /** 目标语言总行数 */
  total: number
}

const EMPTY: LineDiff = { added: new Set(), changed: new Set(), total: 0 }

function toLines(code: string): string[] {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  if (trimmed === '') return []
  // 比较前去掉行尾空白：它不影响语义，却会产生大量假差异
  return trimmed.split('\n').map((line) => line.replace(/\s+$/, ''))
}

export function compareToBaseline(baselineCode: string, targetCode: string): LineDiff {
  const base = toLines(baselineCode)
  const target = toLines(targetCode)
  if (!base.length || !target.length) return EMPTY

  const parts = diffArrays(base, target)
  const added = new Set<number>()
  const changed = new Set<number>()

  let lineNo = 0
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    const size = part.value.length

    if (part.added) {
      // 紧跟在「删除」之后的新增 = 这一块被替换了；否则是纯新增
      const isReplace = parts[i - 1]?.removed === true
      for (let k = 0; k < size; k += 1) {
        const no = lineNo + k + 1
        if (isReplace) changed.add(no)
        else added.add(no)
      }
      lineNo += size
    } else if (!part.removed) {
      lineNo += size
    }
    // removed 的块不推进目标行号
  }

  return { added, changed, total: target.length }
}

/** diff 结果缓存：同一个 (feature, baseline, target) 只算一次 */
const cache = new Map<string, LineDiff>()

export function getCachedDiff(key: string, baselineCode: string, targetCode: string): LineDiff {
  const hit = cache.get(key)
  if (hit) return hit
  const result = compareToBaseline(baselineCode, targetCode)
  cache.set(key, result)
  return result
}

/* ────────────────── 多段代码 ────────────────── */

/**
 * 逐段差异。
 *
 * 每一段有自己的行号空间，把各段拼起来整体 diff 的话，行号对不上任何一段 ——
 * 着色会整体错位。所以两侧**段数一致**时按序号逐段算。
 *
 * 段数不一致（一侧单段、一侧多段，或段数不同）时返回 null ——
 * 接口不知道该怎么配对，由调用方降级为整体 diff 并在界面上说明未做逐行对照。
 */
export function compareBlockArrays(
  baseCodes: string[],
  targetCodes: string[],
): Array<LineDiff> | null {
  if (!baseCodes.length || baseCodes.length !== targetCodes.length) return null
  return baseCodes.map((code, i) => compareToBaseline(code, targetCodes[i]!))
}

const blockCache = new Map<string, Array<LineDiff> | null>()

export function getCachedBlockDiffs(
  key: string,
  baseCodes: string[],
  targetCodes: string[],
): Array<LineDiff> | null {
  if (blockCache.has(key)) return blockCache.get(key)!
  const result = compareBlockArrays(baseCodes, targetCodes)
  blockCache.set(key, result)
  return result
}
