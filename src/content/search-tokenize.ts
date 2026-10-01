/**
 * 中英混合分词 —— **构建期建索引与客户端查询必须共用这一份实现**。
 *
 * 分成两份（各写一遍）会导致 token 对不上，而且失败方式是静默的：
 * 索引建得出来、查询也跑得动，就是命中率莫名其妙地低，极难排查。
 *
 * ── 为什么不用 Intl.Segmenter ──
 * 实测它对中文断词并不可靠（Node 22 / full-icu）：
 *   '数组与列表'   → ['数','组','与','列表']      ← 「数组」这个整体直接丢了
 *   '空数组是真值' → ['空','数','组','是','真','值']
 *   '字符串格式化' → ['字符','串','格式化']        ← 「字符串」被切碎
 * 用这种结果建索引，搜「数组」几乎命中不了。
 *
 * ── 所以中文走 bigram ──
 * 每个汉字单独出一个 token，再把相邻两字组成二元组。这样**任意两字词组**
 * 都必然出现在索引里（既不用词典，也不会有切分歧义）。
 * 配合查询侧的 AND 组合（见 SearchView），unigram 不会带来噪音：
 * 搜「数组」要求文档同时含「数」「组」「数组」，只有真讲数组的才命中。
 *
 * ── 拉丁词与符号 ──
 * 英文/数字按整词保留（MiniSearch 自带前缀匹配，搜 toFix 能命中 toFixed）。
 * 纯符号片段（如 `?.` `??=`）也保留 —— 用户搜代码符号是真实需求。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  // 捕获组 split：字母数字作为分隔出来的片段，符号串则留在中间位置
  for (const part of text.toLowerCase().split(/([\p{L}\p{N}]+)/u)) {
    if (!part) continue

    if (!/[\p{L}\p{N}]/u.test(part)) {
      // 纯符号片段。长度设上限，避免把整段分隔符当成 token
      const sym = part.trim()
      if (sym && sym.length <= 4) out.push(sym)
      continue
    }

    if (/^[\p{Script=Latin}\p{N}]+$/u.test(part)) {
      out.push(part)
      continue
    }

    // 含汉字的片段：unigram + bigram
    const chars = [...part]
    for (let i = 0; i < chars.length; i += 1) {
      out.push(chars[i]!)
      if (i + 1 < chars.length) out.push(chars[i]! + chars[i + 1]!)
    }
  }
  return out
}

/**
 * 查询串 → token。与建索引侧同源，但**去掉单字**：
 * 查询里的单字会大幅放宽 AND 条件（搜「数组」时不希望「数」单独成为必含项），
 * 而 bigram 已经覆盖了两字以上的检索需求。
 * 单独搜一个汉字（如「值」）时，退化为只按该字匹配，仍可用。
 */
export function tokenizeQuery(query: string): string[] {
  const tokens = tokenize(query)
  const multi = tokens.filter((t) => t.length > 1)
  return multi.length > 0 ? multi : tokens
}
