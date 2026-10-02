/**
 * 内容分析与校验 —— validate 与 build 共用同一份装载/合并/检查逻辑。
 *
 * 为什么要共用：如果校验用一套装载、构建用另一套，「校验通过但构建出问题」
 * 就是必然结果。这里保证两者看到的内容完全一致。
 */
import path from 'node:path'
import type {
  AttributionEntry,
  Chapter,
  Feature,
  Issue,
  LanguageMeta,
  Registry,
  ScopedGlossary,
  ScopedPitfall,
  ScopedRoadmapStage,
  SnippetSource,
} from '../../src/schemas'
import {
  extractNotes,
  isSafeUrl,
  listLanguageIds,
  listTopicIds,
  loadAllLanguageMeta,
  loadChapters,
  loadPairLists,
  loadRegistry,
  loadSnippetFiles,
  ROOT,
  type PairLists,
} from './core'
import { detectForeignLanguageMentions } from './lang-mention'

/* ────────────────────────── 许可台账 ────────────────────────── */

/**
 * 许可台账：把「合规」从口头约定变成可检查资产。
 *
 * 台账只登记**实际被使用**的来源 —— 登记了却没内容使用只会制造噪音，
 * 而真正要防的是反过来的情况：有内容使用却没登记义务（见下面 R3 的检查）。
 *
 * 每条必须回答三个问题：这个许可要求我做什么？我在哪履行了？用在哪？
 */
const LEDGER_TEMPLATE: Record<string, Omit<AttributionEntry, 'usedBy' | 'sourceId'>> = {
  thealgorithms: {
    url: 'https://github.com/TheAlgorithms',
    license: 'MIT',
    obligation: '保留版权声明与许可文本',
    fulfilledAt: ['/attributions#thealgorithms', '页脚全局声明'],
  },
  rosettacode: {
    url: 'https://rosettacode.org/',
    license: 'GFDL-1.2',
    obligation: '不得逐字复制；必须改写 + 逐条署名 + 独立署名页 + 页脚 GFDL 声明',
    fulfilledAt: ['/attributions#rosettacode'],
  },
  manual: {
    license: 'CC-BY-4.0',
    obligation: '本工具原创内容，署名本站即可',
    fulfilledAt: ['/attributions#manual'],
  },
}

/**
 * `llm` 产出不产生可署名许可，因此**刻意不进台账**（ADR-08）。
 * 它的合规责任由「人工审阅记录 + 页面上的未校对标记」承担。
 */
const NON_LEDGER_ORIGINS = new Set(['llm'])

/* ────────────────────────── 分析结果 ────────────────────────── */

export interface SnippetRef {
  featureId: string
  lang: string
  raw: SnippetSource
}

export interface Analysis {
  registry: Registry
  metas: LanguageMeta[]
  allLanguageIds: string[]
  enabledLanguageIds: string[]
  metaById: Record<string, LanguageMeta>
  chapters: Chapter[]
  features: Array<{ feature: Feature; chapter: Chapter }>
  snippets: Map<string, Map<string, SnippetSource>> // featureId -> lang -> snippet
  /** 按 (基准, 目标) 对分组的陷阱 / 词典 / 路线 */
  pairs: PairLists[]
  /** 扁平化的陷阱（跨对），供搜索索引与全局视图 */
  pitfalls: ScopedPitfall[]
  glossary: ScopedGlossary[]
  /** key = `${baseline}|${target}` */
  roadmaps: Record<string, ScopedRoadmapStage[]>
  attributions: AttributionEntry[]
  issues: Issue[]
  stats: {
    featureCount: number
    snippetCount: number
    byState: Record<string, number>
    byOrigin: Record<string, number>
    coverage: Record<string, { have: number; total: number }>
  }
}

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/')

/** 多列板块基准列 body 里点名他语言的一次命中 */
export interface BaselineBodyMention {
  topicId: string
  featureId: string
  /** 被点名语言的显示名 */
  name: string
  /** 具体命中的那个词，便于排查误报 */
  word: string
}

/**
 * 扫描「多列板块的基准列 body 点名了屏幕外的语言」。
 *
 * 为什么单独抽出来：这条判定有两个消费者，而且两边的输出形态**刻意不同** ——
 *   · 校验（R12）按 `(topic, 被点名语言)` **汇总**成一条：迁移后 294 条基准列
 *     正文里有一百多条命中，逐条会打印上百行，把真正要看的 error 埋掉
 *   · `npm run content:report` 列出**逐条明细**，那才是能照着清的分批待办
 *
 * 两份输出共用这一个函数，避免「报告说还有 176 条，校验说 170 条」这种对不上。
 */
function scanBaselineBodies(ctx: {
  features: Array<{ feature: Feature; chapter: Chapter }>
  snippets: Map<string, Map<string, SnippetSource>>
  registry: Registry
  enabledLanguageIds: string[]
  metaById: Record<string, LanguageMeta>
}): BaselineBodyMention[] {
  const out: BaselineBodyMention[] = []
  for (const { feature, chapter } of ctx.features) {
    const cfg = ctx.registry.topics[chapter.topicId]
    if (!cfg?.enabled) continue
    /* 只查多列板块：单列板块（migration）的基准列讲 target 正是教学内容本身 */
    if (ctx.registry.sections[cfg.section]?.columns !== 'multi') continue
    const s = ctx.snippets.get(feature.id)?.get(cfg.baseline)
    if (!s?.body?.trim()) continue
    const mentionable = ctx.enabledLanguageIds
      .map((id) => ctx.metaById[id])
      .filter((m): m is LanguageMeta => Boolean(m))
      .filter((m) => m.id !== cfg.baseline)
    const hits = detectForeignLanguageMentions(
      [{ line: 0, text: s.body, tone: 'info' }],
      cfg.baseline,
      mentionable,
    )
    for (const m of hits) {
      out.push({ topicId: chapter.topicId, featureId: feature.id, name: m.name, word: m.word })
    }
  }
  return out
}

/** `scanBaselineBodies` 的对外入口 —— 供 `npm run content:report` 列待清理明细 */
export function baselineBodyMentions(a: Analysis): BaselineBodyMention[] {
  return scanBaselineBodies(a)
}

export function analyzeContent(): Analysis {
  const issues: Issue[] = []
  const err = (rule: string, where: string, message: string) =>
    issues.push({ rule, level: 'error', where, message })
  const warn = (rule: string, where: string, message: string) =>
    issues.push({ rule, level: 'warn', where, message })

  /* R1 结构合法性 —— loader 内部用 Zod 校验，失败即抛 */
  const registry = loadRegistry()
  const metas = loadAllLanguageMeta()
  const allLanguageIds = metas.map((m) => m.id)
  const metaById = Object.fromEntries(metas.map((m) => [m.id, m]))

  // R8 命名与一致性
  const dirIds = listLanguageIds()
  for (const id of dirIds) {
    if (metaById[id]?.id !== id) {
      err('R8', `content/languages/${id}/meta.yaml`, `meta.id = '${metaById[id]?.id}' 与目录名不一致`)
    }
    if (!(id in registry.languages)) {
      err('R8', `content/languages/${id}`, '有 meta.yaml 但未在 content/registry.yaml 注册')
    }
  }
  for (const id of Object.keys(registry.languages)) {
    if (!dirIds.includes(id)) {
      err('R8', 'content/registry.yaml', `登记了 '${id}' 但找不到对应语言目录`)
    }
  }

  const enabledLanguageIds = allLanguageIds.filter((id) => registry.languages[id]?.enabled)

  /**
   * 基准相关约束 —— 与 scripts/build/generate-registry.ts 是**同一套判据**。
   *
   * 那边抛错终止、这边累积 error，两处必须同步改：判据不一致会产出
   * 「校验放行但构建 throw」这种最难定位的组合。
   *
   * 语义：默认基准唯一（defaultBaseline），但**基准候选可以多门**
   * （各语言 meta 的 baseline: true）—— 候选是可选的参照系集合，
   * 默认值是首访与 SSG 静态文案用的那一个。
   */
  const baselineCandidateIds = metas.filter((m) => m.baseline).map((m) => m.id)
  if (!baselineCandidateIds.length) {
    err('R8', 'content/languages/*/meta.yaml', '没有任何语言标了 baseline: true —— 至少要有一门基准候选')
  }
  for (const id of baselineCandidateIds) {
    if (!enabledLanguageIds.includes(id)) {
      err(
        'R8',
        `content/languages/${id}/meta.yaml`,
        '标了 baseline: true 但未启用 —— 基准候选必须是已启用语言',
      )
    }
  }
  if (!enabledLanguageIds.includes(registry.defaultBaseline)) {
    err('R8', 'content/registry.yaml', `defaultBaseline = '${registry.defaultBaseline}' 必须是已启用的语言`)
  } else if (!baselineCandidateIds.includes(registry.defaultBaseline)) {
    err(
      'R8',
      'content/registry.yaml',
      `defaultBaseline = '${registry.defaultBaseline}' 不在基准候选里` +
        `（候选：${baselineCandidateIds.join(', ') || '空'}）—— 请在该语言的 meta.yaml 里标 baseline: true`,
    )
  }
  /*
   * 默认对比语言：必须已启用，且不能就是默认基准 ——
   * 拿基准自己当对比列会渲染出一个恒等于基准的空列。
   */
  if (!enabledLanguageIds.includes(registry.defaultCompareLanguage)) {
    err(
      'R8',
      'content/registry.yaml',
      `defaultCompareLanguage = '${registry.defaultCompareLanguage}' 必须是已启用的语言`,
    )
  } else if (registry.defaultCompareLanguage === registry.defaultBaseline) {
    err(
      'R8',
      'content/registry.yaml',
      'defaultCompareLanguage 不能与 defaultBaseline 相同 —— 对比列必须有一门不同于基准的语言',
    )
  }

  /* topic 的语言范围与三轴字段：必须是已知语言，否则 R2 会静默漏算 */
  for (const [topicId, cfg] of Object.entries(registry.topics)) {
    for (const id of cfg.languages ?? []) {
      if (!allLanguageIds.includes(id)) {
        err('R8', 'content/registry.yaml', `topic '${topicId}' 的 languages 含未知语言 '${id}'`)
      }
    }
    for (const [field, value] of [
      ['baseline', cfg.baseline],
      ['target', cfg.target],
    ] as const) {
      if (!value) continue
      if (!allLanguageIds.includes(value)) {
        err('R8', 'content/registry.yaml', `topic '${topicId}' 的 ${field} 含未知语言 '${value}'`)
      } else if (!enabledLanguageIds.includes(value)) {
        err(
          'R8',
          'content/registry.yaml',
          `topic '${topicId}' 的 ${field} = '${value}' 未启用 —— 未启用的语言没有内容页可渲染`,
        )
      }
    }
    /*
     * basics 的基准必须是「基准候选」，否则会出现一个切不过去的基准：
     * 内容存在、URL 能打开，但基准选择器里没有它，用户永远到不了。
     */
    if (cfg.section === 'basics' && cfg.baseline && !baselineCandidateIds.includes(cfg.baseline)) {
      err(
        'R8',
        'content/registry.yaml',
        `basics topic '${topicId}' 的 baseline = '${cfg.baseline}' 不是基准候选` +
          `（候选：${baselineCandidateIds.join(', ')}）—— 请在该语言的 meta.yaml 里标 baseline: true`,
      )
    }
  }

  /* topic 目录与 registry 必须一一对应（章节与列表资源都靠目录装载，写错会静默不渲染） */
  const topicDirIds = listTopicIds()
  for (const id of topicDirIds) {
    if (!(id in registry.topics)) {
      err('R8', `content/topics/${id}`, '目录存在但未在 content/registry.yaml 登记')
    }
  }
  for (const topicId of Object.keys(registry.topics)) {
    if (!topicDirIds.includes(topicId)) {
      err('R8', 'content/registry.yaml', `登记了 topic '${topicId}' 但找不到 content/topics/${topicId}/ 目录`)
    }
  }

  /* 章节与 Feature */
  const chapters = loadChapters()
  const featureIds = new Set<string>()
  const features: Analysis['features'] = []
  for (const chapter of chapters) {
    if (chapter.topicId !== chapter.id.split('/')[0]) {
      err('R8', `content/topics/${chapter.topicId}`, `章节 id '${chapter.id}' 的前缀应等于 topicId '${chapter.topicId}'`)
    }
    for (const feature of chapter.features) {
      if (featureIds.has(feature.id)) {
        err('R8', 'content/topics', `featureId 重复：${feature.id}`)
      }
      /*
       * R13：featureId 的前缀必须等于所属 topic 的 id。
       *
       * feature 内联在章节里，归属本来是明确的；但语言覆盖层**按 featureId 挂接**，
       * 前缀写错会让实现挂到别的 topic 上（或根本挂不上），而构建全程不报错 ——
       * 表现为那一格永远空着。章节 id 的前缀早有 R8 钉住，feature 这层一直空着。
       */
      if (feature.id.split('/')[0] !== chapter.topicId) {
        err(
          'R13',
          `content/topics/${chapter.topicId}`,
          `featureId '${feature.id}' 的前缀应等于 topicId '${chapter.topicId}'`,
        )
      }
      featureIds.add(feature.id)
      features.push({ feature, chapter })
    }
  }

  /* R5 软引用完整性 —— 迁移教程的小节指向概念详解（refFeatureId） */
  for (const { feature, chapter } of features) {
    const ref = feature.refFeatureId
    if (!ref) continue
    if (ref === feature.id) {
      err('R5', `content/topics/${chapter.topicId}`, `feature '${feature.id}' 的 refFeatureId 指向自己`)
    } else if (!featureIds.has(ref)) {
      err(
        'R5',
        `content/topics/${chapter.topicId}`,
        `feature '${feature.id}' 的 refFeatureId '${ref}' 不存在`,
      )
    }
  }

  /* R5 引用完整性 */
  const snippets = new Map<string, Map<string, SnippetSource>>()
  const allSnippetFiles: Array<{
    lang: string
    file: string
    topic: string
    items: SnippetSource[]
  }> = []
  for (const lang of dirIds) {
    // 按文件分组保留真实路径 —— 此前的 file 字段拼的是一个不存在的 `snippets.yaml`，
    // 报错定位不到实际文件
    for (const group of loadSnippetFiles(lang)) {
      allSnippetFiles.push({ lang, file: group.file, topic: group.topic, items: group.items })
    }
  }
  for (const { lang, file, topic, items } of allSnippetFiles) {
    /*
     * R15：文件声明的 topic 必须与所在目录、与每条 featureId 的前缀一致。
     *
     * 三者一致才能保证「实现挂到了它以为是的那条 feature 上」。此前这条链
     * 只有一个语言目录这一层，前缀靠人记 —— 分目录之后有了显式声明，就能校验。
     */
    const dirName = /[\\/]snippets[\\/]([^\\/]+)[\\/]/.exec(file)?.[1]
    if (dirName && dirName !== topic) {
      err('R15', file, `所在目录 '${dirName}' 与文件声明的 topic '${topic}' 不一致`)
    }

    for (const s of items) {
      if (s.featureId.split('/')[0] !== topic) {
        err(
          'R15',
          file,
          `文件声明 topic: '${topic}'，但 featureId '${s.featureId}' 的前缀是 '${s.featureId.split('/')[0]}'`,
        )
      }
      if (!featureIds.has(s.featureId)) {
        err('R5', file, `孤儿 snippet：featureId '${s.featureId}' 在 topics 里不存在`)
        continue
      }
      if (!allLanguageIds.includes(lang)) {
        err('R5', file, `语言 '${lang}' 不在语言目录列表中`)
      }
      /*
       * R17：校对状态升级了却没留校对记录。
       *
       * `review.state` 是页面「未经人工校对」标记的唯一依据，也是切到
       * reviewed-only 发布策略时的闸门。升级 state 却不记谁在什么时候校的，
       * 等于让那个标记失去可追溯性。
       */
      if (s.review.state !== 'draft' && (!s.review.reviewedBy || !s.review.reviewedAt)) {
        warn(
          'R17',
          file,
          `featureId '${s.featureId}' 标为 ${s.review.state}，但缺少 reviewedBy / reviewedAt`,
        )
      }
      const bucket = snippets.get(s.featureId) ?? new Map<string, SnippetSource>()
      if (bucket.has(lang)) {
        err('R8', file, `featureId '${s.featureId}' 在 '${lang}' 下重复定义`)
      }
      bucket.set(lang, s)
      snippets.set(s.featureId, bucket)
    }
  }

  /**
   * 某个 topic 的**适用语言范围** —— 缺省 = 全部已启用语言。
   *
   * 迁移教程是这个机制的第一个使用者：一个 js→python 方向只涉及两门语言，
   * 若仍按「已启用语言 × feature」计算，每格都会报「缺少 rust 的实现」。
   */
  const scopeOfTopic = (topicId: string): string[] => {
    const scope = registry.topics[topicId]?.languages
    if (!scope?.length) return enabledLanguageIds
    return enabledLanguageIds.filter((id) => scope.includes(id))
  }

  /**
   * 板块是否**多列并排**（`columns: multi`）—— 基础语法与心智模型。
   *
   * 与 `src/content/repository.ts` 的 `sectionIsMulti` 同源（都读板块注册表的
   * `columns`），但那边经 `import.meta.glob` 取 manifest，Node 侧不可用，
   * 所以这里直接读 registry。
   *
   * **判据必须是 `columns` 而不是板块 id**：R12 早先写的是 `section === 'basics'`，
   * 于是 concepts 板块只因为「恰好没有 target」才走对了分支 —— 再加一个多列板块
   * 就会静默走错。
   */
  const isMultiColumn = (topicId: string): boolean => {
    const section = registry.topics[topicId]?.section
    return section ? registry.sections[section]?.columns === 'multi' : false
  }

  /* R2 覆盖率：适用范围内的语言不能有空洞 */
  const coverage: Record<string, { have: number; total: number }> = {}
  for (const lang of enabledLanguageIds) coverage[lang] = { have: 0, total: 0 }
  /**
   * 未启用语言已写好的实现数，按语言累计。
   *
   * 为什么汇总而不是逐条 warn：R2 允许「先攒内容后启用」，而攒内容阶段动辄上百条 ——
   * 逐条提示会把整个校验报告淹没，真正需要看的 error 反而找不到了。
   */
  const pendingByLang = new Map<string, number>()

  /**
   * R18 待补 body 的格子数，按 `topicId · lang` 累计。
   *
   * 同样汇总而不逐条：多列板块共 974 格，本次架构改动时其中 762 格还没有
   * body —— 逐条提示会打印一千多行，把真正需要看的 error 彻底埋掉。
   * 明细清单由 `npm run content:report` 给出（那里不受「报告要能一眼扫完」约束）。
   */
  const missingBody = new Map<string, number>()
  /** R19 仍带共享说明的 feature 数，按 topic 累计 */
  const leftoverFeatureBody = new Map<string, number>()
  /** R12 多列板块基准列 body 里点名他语言的次数，按 `topicId · 被点名语言` 累计 */
  const bodyMentions = new Map<string, number>()

  for (const { feature, chapter } of features) {
    const bucket = snippets.get(feature.id)
    const scope = scopeOfTopic(chapter.topicId)
    for (const lang of scope) {
      coverage[lang]!.total += 1
      const s = bucket?.get(lang)
      if (!s) {
        err(
          'R2',
          feature.id,
          `缺少 '${lang}' 的实现。"还没写"和"语言里没有这个概念"必须区分开：确实没有请显式写 equivalence: absent + body 说明替代做法`,
        )
        continue
      }
      coverage[lang]!.have += 1
      /*
       * 「有没有给代码」单段看 code、多段看 blocks —— R16 保证两者恰好有一个。
       * 只看 code 的话，多段实现会被判成「代码为空」而阻断构建。
       */
      const hasCode = Boolean(s.code.trim() || s.blocks?.some((b) => b.code.trim()))
      if (s.equivalence === 'absent' && !s.body?.trim()) {
        warn('R2', `${feature.id} · ${lang}`, 'equivalence 为 absent，但没有用 body 说明替代做法')
      }
      if (s.equivalence === 'absent' && hasCode) {
        warn('R2', `${feature.id} · ${lang}`, 'equivalence 为 absent 但提供了代码，请确认这是「惯用替代写法」而非等价实现')
      }
      if (!hasCode && s.equivalence !== 'absent') {
        err('R2', `${feature.id} · ${lang}`, `equivalence 为 '${s.equivalence}' 但代码为空`)
      }
      /*
       * R18 多列板块的每一格都要有自己的说明。
       *
       * 列数随勾选变化，一份横跨所有列的共享说明盖不住各语言自己的事实，
       * 所以正文下沉到每列代码下方：基准列写本语言的客观事实，对比列写与基准的
       * 差别。排除 absent —— 那种格子已由上面的 R2「absent 无 body」覆盖，
       * 两条一起报只是把同一件事说两遍。
       */
      if (isMultiColumn(chapter.topicId) && s.equivalence !== 'absent' && !s.body?.trim()) {
        const key = `${chapter.topicId} · ${lang}`
        missingBody.set(key, (missingBody.get(key) ?? 0) + 1)
      }
    }
    /*
     * R19 多列板块不再有共享说明。
     *
     * `feature.body` 渲染在整块上方、横跨所有列，而且在矩阵模式下**根本没有
     * 渲染点**（MatrixLayout 不引用 feature.bodyHtml）—— 同一份内容在两种展示
     * 模式下一个有一个没有。正文一律下移到每列 snippet.body。
     */
    if (isMultiColumn(chapter.topicId) && feature.body?.trim()) {
      leftoverFeatureBody.set(chapter.topicId, (leftoverFeatureBody.get(chapter.topicId) ?? 0) + 1)
    }
    // 未启用语言有内容 → 只累计，不算问题（支持「先攒内容后启用」）
    for (const [lang] of bucket ?? []) {
      if (!enabledLanguageIds.includes(lang)) {
        pendingByLang.set(lang, (pendingByLang.get(lang) ?? 0) + 1)
      }
    }
  }

  for (const [lang, count] of [...pendingByLang].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R2',
      `content/languages/${lang}`,
      `${count} 条实现已写好，但 '${lang}' 尚未启用 —— 不会渲染（允许：先攒内容后启用）`,
    )
  }

  /* R4 / R9 内联 @note 标记 */
  /** draft 数量按语言累计：宽松策略下只汇总提示一次，避免几百条逐条刷屏 */
  const draftByLang = new Map<string, number>()

  for (const { feature, chapter } of features) {
    const bucket = snippets.get(feature.id) ?? new Map<string, SnippetSource>()
    for (const [lang, s] of bucket) {
      const meta = metaById[lang]
      if (!meta) continue
      const where = `${feature.id} · ${lang}`
      const markers = (s.code.match(/@note!?\s+/g) ?? []).length
      const { code, allNotes } = extractNotes(s.code, meta.comment.line)
      if (markers !== allNotes.length) {
        err(
          'R4/R9',
          where,
          `检测到 ${markers} 个 @note 标记，但只解析出 ${allNotes.length} 个。标记必须紧跟在 '${meta.comment.line}' 之后（该语言的注释前缀）`,
        )
      }
      if (code.includes('@note')) {
        err('R4', where, '剥离后仍残留 "@note" 文本，请检查标记写法')
      }
      for (const n of allNotes) {
        if (!n.text) warn('R4', `${where} 第 ${n.line} 行`, '@note 说明为空')
      }

      /*
       * R11 有差异必配说明：徽章标了差异，读者却看不到差异在哪。
       *
       * 说明有两个载体 —— 代码里的 `@note`（贴着那一行），以及代码下方的
       * `body`（讲整体的差别）。任一个有内容就算交代过了。
       *
       * 多列板块**跳过**：那里的「没有 body」由 R18 单独负责，而 R18 的触发集
       * 恰好覆盖 R11 剩下的那一半，两条一起报只是把同一格数两遍。
       */
      if (
        !isMultiColumn(chapter.topicId) &&
        s.equivalence !== 'identical' &&
        allNotes.length === 0 &&
        !s.body?.trim()
      ) {
        warn(
          'R11',
          where,
          `equivalence 为 '${s.equivalence}' 却既没有 @note 也没有 body 说明差异。请补一条注记，或在 body 里说明与基准的差别`,
        )
      }

      // R12 基准列的说明只讲本方向的语言：基准列是这一页的参照系，
      // 讲屏幕外的语言会把读者引向并不存在的一列。
      //   · 多列板块的基准列只该讲自己 —— 勾 Java+Go+Rust 时读到一句讲
      //     Python 的说明，就是幽灵语言
      //   · 对级板块只有 baseline↔target 两门，基准列讲 target 正是教学内容本身，
      //     所以那里只禁「第三门语言」
      // 「是不是多列」读板块注册表的 columns，不再写死板块 id（ADR-28）。
      const topicCfg = registry.topics[chapter.topicId]
      if (topicCfg?.enabled && lang === topicCfg.baseline) {
        const allowed = new Set<string>(
          isMultiColumn(chapter.topicId)
            ? [lang]
            : [lang, topicCfg.target ?? ''].filter(Boolean),
        )
        const mentionable = enabledLanguageIds
          .map((id) => metaById[id])
          .filter((m): m is LanguageMeta => Boolean(m))
          .filter((m) => !allowed.has(m.id))
        const foreign = detectForeignLanguageMentions(allNotes, lang, mentionable)
        for (const m of foreign) {
          warn(
            'R12',
            `${where} 第 ${m.line} 行`,
            `基准列注记点名了 '${m.name}'（命中「${m.word}」）：对照说明应写在对应语言的对比列实现里`,
          )
        }
      }
    }
  }

  /*
   * R18 / R19 / R12-body 的汇总输出。
   *
   * **必须放在所有累加循环之后**：`bodyMentions` 是在上面 R4/R9 那个循环里填的，
   * 输出写早了会永远打印 0 条（本轮真踩到过）。
   *
   * 三条都用「按 topic / 按列汇总一条」而不是逐条 emit：多列板块共 974 格，
   * 过渡期缺口以百计 —— 逐条会打印上千行，把真正需要看的 error 埋掉
   * （同 `pendingByLang` / `draftByLang` 的理由）。明细清单交给
   * `npm run content:report`，那里不受「报告要能一眼扫完」的约束。
   *
   * 级别都是 warn：正文按 topic 分批补，补完之前就把构建变红毫无意义 ——
   * 那会把「内容还没写完」和「内容写错了」混成同一种信号。等 report 里的
   * 待补账目归零后，把 `warn(` 改成 `err(` 即可翻级。
   */
  for (const [key, count] of [...missingBody].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R18',
      key,
      `多列板块的这一列还有 ${count} 格没有 body 说明。每格都该有自己的说明：基准列写本语言的客观事实，对比列写与基准的差别（相关的事实性提醒走代码里的 @note，不要重复成段）`,
    )
  }
  for (const [topicId, count] of [...leftoverFeatureBody].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R19',
      topicId,
      `多列板块仍有 ${count} 条 feature 带着共享说明 feature.body。列数随勾选变化，共享说明盖不住各语言自己的事实，也不进矩阵视图 —— 请把正文下移到每列 snippet.body`,
    )
  }
  /*
   * 扫描范围含 body：说明下沉到每列之后，正文成了差异说明的主要载体 ——
   * 只扫 @note 的话，「基准列讲别的语言」会从正文里整段溜过去。
   * 判定与 `baselineBodyMentions` 共用一份，报告里的待清理明细才与这里对得上。
   */
  for (const hit of scanBaselineBodies({
    features,
    snippets,
    registry,
    enabledLanguageIds,
    metaById,
  })) {
    const key = `${hit.topicId} · 基准列 body 点名 ${hit.name}`
    bodyMentions.set(key, (bodyMentions.get(key) ?? 0) + 1)
  }
  for (const [key, count] of [...bodyMentions].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R12',
      key,
      `基准列的 body 说明里有 ${count} 条点名了屏幕外的语言。基准列是这一页的参照系，对照说明应写在对应语言的对比列实现里`,
    )
  }

  /* R3 provenance 与真实台账 */
  const usedBySource: Record<string, string[]> = {}
  const byOrigin: Record<string, number> = {}
  const byState: Record<string, number> = {}
  let snippetCount = 0
  for (const { feature } of features) {
    const bucket = snippets.get(feature.id) ?? new Map<string, SnippetSource>()
    for (const [lang, s] of bucket) {
      if (!enabledLanguageIds.includes(lang)) continue
      snippetCount += 1
      const where = `${feature.id} · ${lang}`
      const p = s.review.provenance
      byOrigin[p.origin] = (byOrigin[p.origin] ?? 0) + 1
      byState[s.review.state] = (byState[s.review.state] ?? 0) + 1

      usedBySource[p.origin] ??= []
      usedBySource[p.origin]!.push(where)

      // R7 协议白名单（真实存在的 url 必须 https）
      if ('url' in p && p.url && !isSafeUrl(p.url)) {
        err('R7', where, `provenance.url 不是 https：${p.url}`)
      }
      if (p.origin === 'thealgorithms' && !p.retrievedAt) {
        err('R3', where, 'thealgorithms 来源必须记录 retrievedAt')
      }
      if (p.origin === 'llm' && (!p.model || !p.promptTemplateId)) {
        err('R3', where, 'llm 来源必须记录 model 与 promptTemplateId')
      }

      // R6 发布门槛
      if (s.review.state === 'draft') {
        draftByLang.set(lang, (draftByLang.get(lang) ?? 0) + 1)
        if (registry.publishPolicy === 'reviewed-only') {
          err('R6', where, 'publishPolicy 为 reviewed-only，draft 不允许进入生产构建')
        }
      }
      if (s.review.state !== 'draft' && !s.review.reviewedBy) {
        warn('R3', where, `state 为 '${s.review.state}' 但未记录 reviewedBy`)
      }
    }
  }

  /*
   * 宽松策略下也得让人知道「有多少未校对内容正在进入构建」——
   * 否则 draft 会静静地发布出去，而「未校对」这件事只在页面上看得到、在构建日志里看不到。
   */
  if (draftByLang.size > 0 && registry.publishPolicy === 'include-draft-with-badge') {
    const total = [...draftByLang.values()].reduce((a, b) => a + b, 0)
    const detail = [...draftByLang]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([l, n]) => `${l} ${n}`)
      .join(' / ')
    warn(
      'R6',
      'content/',
      `当前 ${total} 条 draft 会进入构建（${detail}）—— 页面上会显示「未经人工校对」标记`,
    )
  }

  /* 台账只登记实际使用的来源；反过来，使用了却没登记义务的会被 R3 拦住 */
  const attributions: AttributionEntry[] = []
  for (const origin of Object.keys(usedBySource).sort()) {
    if (NON_LEDGER_ORIGINS.has(origin)) continue
    const template = LEDGER_TEMPLATE[origin]
    if (!template) {
      err('R3', origin, `来源 '${origin}' 有内容使用，但没有在许可台账模板里登记义务与履行位置`)
      continue
    }
    attributions.push({
      sourceId: origin,
      ...template,
      usedBy: [...new Set(usedBySource[origin] ?? [])].sort(),
    })
  }
  for (const e of attributions) {
    if (!e.fulfilledAt.length) {
      err('R10', `/attributions#${e.sourceId}`, `'${e.sourceId}' 的许可义务没有登记履行位置`)
    }
    for (const where of e.fulfilledAt) {
      if (!where.startsWith('/') && !where.includes('页脚')) {
        warn('R10', `/attributions#${e.sourceId}`, `履行位置 '${where}' 不像一个可核对的落点`)
      }
    }
  }

  /*
   * 踩坑 / 术语 / 路线图 —— 三者都是**对级**资源，归属由所属目录的 topic 决定。
   * pairLists 只包含 registry 里登记过的对目录，因此「目录名写错」这类问题
   * 会在上面的目录比对里报出来，而不是在这里静默消失。
   */
  const pairs = loadPairLists(registry)
  const pitfalls: ScopedPitfall[] = []
  const glossary: ScopedGlossary[] = []
  const roadmaps: Record<string, ScopedRoadmapStage[]> = {}

  for (const pair of pairs) {
    const where = rel(pair.dir)
    const allowed = new Set([pair.baseline, pair.target])

    for (const p of pair.pitfalls) {
      pitfalls.push(p)
      if (p.featureId && !featureIds.has(p.featureId)) {
        err('R5', `${where}/pitfalls.yaml#${p.id}`, `featureId '${p.featureId}' 不存在`)
      }
      for (const lang of p.languages) {
        if (!allLanguageIds.includes(lang)) {
          err('R5', `${where}/pitfalls.yaml#${p.id}`, `语言 '${lang}' 不存在`)
        }
      }
    }

    /*
     * 对级词典只允许讲这一个方向的两门语言。
     * 留着一门第三语言，读者会以为「带着当前基准的习惯」也会在那里踩到同样的坑 ——
     * 而这条术语根本没在讲那个方向。
     */
    for (const g of pair.glossary) {
      glossary.push(g)
      for (const lang of Object.keys(g.perLanguage)) {
        if (!allLanguageIds.includes(lang)) {
          err('R5', `${where}/glossary.yaml「${g.term}」`, `perLanguage 引用了不存在的语言 '${lang}'`)
        } else if (!allowed.has(lang)) {
          err(
            'R5',
            `${where}/glossary.yaml「${g.term}」`,
            `perLanguage 含 '${lang}'，但本目录只讲 ${pair.baseline} → ${pair.target}` +
              '（对级词典只能讲这两门语言）',
          )
        }
      }
    }

    const stages = pair.roadmaps
    if (stages.length) roadmaps[`${pair.baseline}|${pair.target}`] = stages
    for (const s of stages) {
      for (const r of s.resources) {
        if (!isSafeUrl(r.url)) err('R7', `${where}/roadmap.yaml ${s.id}`, `资源 url 不是 https：${r.url}`)
      }
    }
  }

  /*
   * 骨架期的「还差哪些方向」—— 汇总成 warn 而不是 error。
   *
   * 12 个方向 × 5 个板块不可能一次写全，而 R2 对已登记 topic 是 error 级：
   * 把「还没开始的方向」也做成 error，等于让整条构建流水线在补齐内容前一直红着。
   * 这里沿用「先攒内容后启用」的既有风格 —— 缺失可见，但不拦人。
   */
  const declaredPairs = new Set(
    Object.values(registry.topics)
      .filter((c) => c.target)
      .map((c) => `${c.baseline}|${c.target}`),
  )
  for (const baseline of baselineCandidateIds) {
    const missing = enabledLanguageIds.filter(
      (id) => id !== baseline && !declaredPairs.has(`${baseline}|${id}`),
    )
    if (missing.length) {
      warn(
        'R5',
        'content/registry.yaml',
        `基准 '${baseline}' 下还没有这些方向的迁移内容：${missing.join(', ')}（骨架期允许，补齐后在 registry 登记）`,
      )
    }
  }

  // R7 语言链接
  for (const m of metas) {
    for (const l of m.links) {
      if (!isSafeUrl(l.url)) err('R7', `meta ${m.id}`, `链接不是 https：${l.url}`)
    }
  }

  return {
    registry,
    metas,
    allLanguageIds,
    enabledLanguageIds,
    metaById,
    chapters,
    features,
    snippets,
    pairs,
    pitfalls,
    glossary,
    roadmaps,
    attributions,
    issues,
    stats: {
      featureCount: features.length,
      snippetCount,
      byState,
      byOrigin,
      coverage,
    },
  }
}

export function formatIssues(issues: Issue[]): string {
  if (!issues.length) return '  （无）'
  return issues
    .map((i) => `  ${i.level === 'error' ? '✗' : '!'} [${i.rule}] ${i.where}\n      ${i.message}`)
    .join('\n')
}
