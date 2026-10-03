/**
 * 内容分析与校验（v2）—— validate 与 build 共用同一份装载/合并/检查逻辑。
 *
 * 为什么要共用：如果校验用一套装载、构建用另一套，「校验通过但构建出问题」
 * 就是必然结果。这里保证两者看到的内容完全一致。
 *
 * v2 的规则集换了口径：内容按**语言**组织（每门语言为每个基准各写一份差异），
 * 清单集中在 content/catalog/。旧架构里服务于「三轴 + 两种 scope」的大批规则
 * （覆盖率按 topic.languages 范围、板块成员资格、多列板块的正文归属…）在 v2
 * 只有一种形态后不再需要，取而代之的是 R20–R26。
 */
import type {
  AttributionEntry,
  BoxSource,
  Catalog,
  CatalogFeature,
  FeatureKind,
  Issue,
  LanguageMeta,
  Registry,
  ScopedGlossary,
  ScopedPitfall,
  ScopedRoadmapStage,
} from '../../src/schemas'
import {
  extractNotes,
  isSafeUrl,
  listLanguageContentFiles,
  listLanguageIds,
  loadAllLanguageMeta,
  loadCatalog,
  loadLanguageContent,
  loadPairListsV2,
  loadRegistry,
  type LanguageChapterContent,
  type PairListsV2,
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

/** 全局 feature id = `<板块>/<章节>/<feature>` —— 四处消费者必须拼同一套 */
export const globalIdOf = (section: string, chapter: string, feature: string): string =>
  `${section}/${chapter}/${feature}`

export interface FeatureEntry {
  feature: CatalogFeature
  section: string
  chapter: string
  id: string
}

export interface Analysis {
  registry: Registry
  metas: LanguageMeta[]
  allLanguageIds: string[]
  enabledLanguageIds: string[]
  /** 基准候选（v2 固定三门）—— `vs` 的 key 集合由它决定 */
  baselineIds: string[]
  metaById: Record<string, LanguageMeta>
  catalogs: Catalog[]
  catalogBySection: Record<string, Catalog>
  /** 有清单的板块（= 章节型板块） */
  chapterSections: string[]
  features: FeatureEntry[]
  /** key = 全局 id */
  featureIndex: Record<
    string,
    { title: string; section: string; chapter: string; kind: FeatureKind }
  >
  /** key = `<语言>/<板块>/<章节>` */
  content: Map<string, LanguageChapterContent>
  /** 全局 id -> 语言 -> 对比框 */
  boxes: Map<string, Map<string, BoxSource>>
  /** 按 (基准, 目标) 分组的三份列表资源 */
  pairs: PairListsV2[]
  pitfalls: ScopedPitfall[]
  glossary: ScopedGlossary[]
  /** key = `${baseline}|${target}` */
  roadmaps: Record<string, ScopedRoadmapStage[]>
  attributions: AttributionEntry[]
  issues: Issue[]
  stats: {
    featureCount: number
    boxCount: number
    byState: Record<string, number>
    byOrigin: Record<string, number>
    /** key = 语言；have = 该语言写了框的 feature 数，total = 清单 feature 总数 */
    coverage: Record<string, { have: number; total: number }>
  }
}

/** 三槽全空？ */
const isEmptyBox = (b: BoxSource): boolean =>
  !b.code.trim() &&
  !(b.blocks?.length ?? 0) &&
  !b.baseline?.trim() &&
  Object.values(b.vs).every((v) => !v.trim())

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

  // R8 语言目录与注册表
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
   * v2 里基准固定为三门（ADR-47）：加一个基准等于让**每一门语言**各补一份
   * 差异说明，是 N 倍成本；定死之后 `vs` 的 key 集合封闭，内容总量可预估。
   */
  const baselineIds = metas.filter((m) => m.baseline).map((m) => m.id)
  if (!baselineIds.length) {
    err('R8', 'content/languages/*/meta.yaml', '没有任何语言标了 baseline: true —— 至少要有一门基准候选')
  }
  for (const id of baselineIds) {
    if (!enabledLanguageIds.includes(id)) {
      err('R8', `content/languages/${id}/meta.yaml`, '标了 baseline: true 但未启用 —— 基准候选必须是已启用语言')
    }
  }
  if (!enabledLanguageIds.includes(registry.defaultBaseline)) {
    err('R8', 'content/registry.yaml', `defaultBaseline = '${registry.defaultBaseline}' 必须是已启用的语言`)
  } else if (!baselineIds.includes(registry.defaultBaseline)) {
    err(
      'R8',
      'content/registry.yaml',
      `defaultBaseline = '${registry.defaultBaseline}' 不在基准候选里` +
        `（候选：${baselineIds.join(', ') || '空'}）—— 请在该语言的 meta.yaml 里标 baseline: true`,
    )
  }
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

  /* ── 清单 ── */
  const { catalogs, issues: catalogIssues } = loadCatalog()
  const catalogBySection: Record<string, Catalog> = {}

  // R20c 文件名与 section 字段一致（loadCatalog 报出来的）
  for (const i of catalogIssues) err('R20', i.where, i.message)

  for (const c of catalogs) {
    if (!(c.section in registry.sections)) {
      err('R20', `content/catalog/${c.section}.yaml`, `section '${c.section}' 不在 registry.yaml 的 sections 段里`)
    }
    if (catalogBySection[c.section]) {
      err('R20', `content/catalog/${c.section}.yaml`, `板块 '${c.section}' 有不止一份清单`)
    }
    catalogBySection[c.section] = c
  }
  const chapterSections = catalogs.map((c) => c.section)

  /* 全局 feature 清单 */
  const features: FeatureEntry[] = []
  const featureIndex: Analysis['featureIndex'] = {}
  for (const c of catalogs) {
    const chapterIds = new Set<string>()
    for (const chapter of c.chapters) {
      if (chapterIds.has(chapter.id)) {
        err('R20', `content/catalog/${c.section}.yaml`, `章节 id 重复：${chapter.id}`)
      }
      chapterIds.add(chapter.id)
      const featureIds = new Set<string>()
      for (const feature of chapter.features) {
        if (featureIds.has(feature.id)) {
          err('R20', `content/catalog/${c.section}.yaml`, `章节 '${chapter.id}' 内 feature id 重复：${feature.id}`)
        }
        featureIds.add(feature.id)
        const id = globalIdOf(c.section, chapter.id, feature.id)
        if (featureIndex[id]) err('R20', `content/catalog/${c.section}.yaml`, `全局 feature id 重复：${id}`)
        features.push({ feature, section: c.section, chapter: chapter.id, id })
        featureIndex[id] = { title: feature.title, section: c.section, chapter: chapter.id, kind: feature.kind }
      }
    }
  }

  /* R5 软引用 —— refFeatureId 写的是全局 id，可跨章 */
  for (const f of features) {
    const ref = f.feature.refFeatureId
    if (!ref) continue
    if (ref === f.id) {
      err('R5', `content/catalog/${f.section}.yaml`, `feature '${f.id}' 的 refFeatureId 指向自己`)
    } else if (!featureIndex[ref]) {
      err('R5', `content/catalog/${f.section}.yaml`, `feature '${f.id}' 的 refFeatureId '${ref}' 不存在`)
    }
  }

  /* ── 语言内容 ── */
  const content = new Map<string, LanguageChapterContent>()
  const boxes = new Map<string, Map<string, BoxSource>>()
  const byState: Record<string, number> = {}
  const byOrigin: Record<string, number> = {}
  const usedBySource: Record<string, string[]> = {}
  const draftByLang = new Map<string, number>()
  const coverage: Record<string, { have: number; total: number }> = {}
  for (const lang of enabledLanguageIds) coverage[lang] = { have: 0, total: features.length }

  // R22 / R24 按 (语言, 板块) 汇总成一条 —— 逐条会打印上百行，把真正要看的 error 埋掉
  const vsMissing = new Map<string, number>()
  const suspectedMissing = new Map<string, number>()
  let boxCount = 0

  for (const lang of dirIds) {
    const meta = metaById[lang]
    if (!meta) continue
    const isCandidate = baselineIds.includes(lang)
    const isEnabled = enabledLanguageIds.includes(lang)
    const commentLine = meta.comment.line

    /* R20a 孤儿文件：语言目录里存在、但清单没登记的 (板块, 章节) */
    const knownChapters = new Set(features.map((f) => `${f.section}/${f.chapter}`))
    for (const f of listLanguageContentFiles(lang)) {
      if (!knownChapters.has(`${f.section}/${f.chapter}`)) {
        err(
          'R20',
          f.file,
          `清单里没有 '${f.section}/${f.chapter}' 这一章 —— 板块目录名或章节文件名写错了，这份内容不会被渲染`,
        )
      }
    }

    for (const group of loadLanguageContent(lang, catalogs)) {
      content.set(`${lang}/${group.section}/${group.chapter}`, group)
      const catalogChapter = catalogBySection[group.section]?.chapters.find((c) => c.id === group.chapter)
      if (!catalogChapter) continue
      const chapterFeatureIds = new Set(catalogChapter.features.map((f) => f.id))

      /* R21 key 合法性 —— boxes 是 z.record，key 全靠这条兜底 */
      for (const key of Object.keys(group.boxes)) {
        if (!chapterFeatureIds.has(key)) {
          err('R21', group.file, `box '${key}' 不在清单的 '${group.section}/${group.chapter}' 章里（拼写错误或孤儿条目）`)
        }
      }

      for (const feature of catalogChapter.features) {
        const box = group.boxes[feature.id]
        const gid = globalIdOf(group.section, group.chapter, feature.id)

        /* R24 存疑的空框 —— 文件在、但这个 feature 没写 */
        if (!box) {
          if (isEnabled) {
            const k = `${lang} · ${group.section}`
            suspectedMissing.set(k, (suspectedMissing.get(k) ?? 0) + 1)
          }
          continue
        }
        if (isEnabled && !box.absent && isEmptyBox(box)) {
          const k = `${lang} · ${group.section}`
          suspectedMissing.set(k, (suspectedMissing.get(k) ?? 0) + 1)
        }

        /* R4/R9 注记标记必须被解析干净 */
        const code = box.blocks?.length ? box.blocks.map((b) => b.code).join('\n') : box.code
        if (code.trim()) {
          const extracted = extractNotes(code, commentLine)
          if (/@note/.test(extracted.code)) {
            err(
              'R4/R9',
              `${group.file} → ${feature.id}`,
              `代码里残留 @note 标记 —— 标记必须写在注释前缀（'${commentLine}'）之后`,
            )
          }
        }

        /* R22 vs 完整性 */
        const required = isCandidate ? baselineIds.filter((b) => b !== lang) : baselineIds
        const missing = required.filter((b) => !box.vs[b]?.trim())
        if (missing.length && isEnabled) {
          const k = `${lang} · ${group.section}`
          vsMissing.set(k, (vsMissing.get(k) ?? 0) + missing.length)
        }

        /* R23 基准列的 baseline 不可空 */
        if (isCandidate && isEnabled && !box.baseline?.trim()) {
          warn('R23', `${group.file} → ${feature.id}`, `'${lang}' 是基准候选，这个 feature 缺 baseline 说明（基准列不能空着）`)
        }

        /* R26 absent 且给了代码（惯用替代写法）→ 必须有说明 */
        const hasExplain = Boolean(box.baseline?.trim()) || Object.values(box.vs).some((v) => v.trim())
        if (box.absent && (box.code.trim() || (box.blocks?.length ?? 0)) && !hasExplain) {
          warn(
            'R26',
            `${group.file} → ${feature.id}`,
            'absent 的格子给了代码（惯用替代写法），但没有 baseline / vs 说明 —— 读者无从知道这是「没有等价语法」而非「写法不同」',
          )
        }

        /* R25 说明的基准归属：vs.<K> 是写给「以 K 为基准的读者」的，提第三门就是屏幕外的幽灵语言 */
        for (const [base, text] of Object.entries(box.vs)) {
          if (!text.trim()) continue
          const mentionable = metas.filter(
            (m) => enabledLanguageIds.includes(m.id) && m.id !== lang && m.id !== base,
          )
          for (const hit of detectForeignLanguageMentions([{ line: 0, text, tone: 'info' }], lang, mentionable)) {
            warn('R25', `${group.file} → ${feature.id}`, `vs.${base} 里点名了 ${hit.name}（「${hit.word}」）—— 屏幕外是 ${lang} 与 ${base} 两列`)
          }
        }
        if (box.baseline?.trim()) {
          const mentionable = metas.filter((m) => enabledLanguageIds.includes(m.id) && m.id !== lang)
          for (const hit of detectForeignLanguageMentions(
            [{ line: 0, text: box.baseline, tone: 'info' }],
            lang,
            mentionable,
          )) {
            warn('R25', `${group.file} → ${feature.id}`, `baseline 里点名了 ${hit.name}（「${hit.word}」）—— 基准列只讲 ${lang} 自己`)
          }
        }

        if (!isEnabled) continue

        /* R17 校对状态升级需留记录 */
        if (box.review.state !== 'draft' && (!box.review.reviewedBy || !box.review.reviewedAt)) {
          warn('R17', group.file, `'${feature.id}' 标为 ${box.review.state}，但缺少 reviewedBy / reviewedAt`)
        }

        /* R3 provenance / R7 url / R6 发布门槛 */
        const where = `${gid} · ${lang}`
        const p = box.review.provenance
        byOrigin[p.origin] = (byOrigin[p.origin] ?? 0) + 1
        byState[box.review.state] = (byState[box.review.state] ?? 0) + 1
        boxCount += 1
        usedBySource[p.origin] ??= []
        usedBySource[p.origin]!.push(where)

        if ('url' in p && p.url && !isSafeUrl(p.url)) err('R7', where, `provenance.url 不是 https：${p.url}`)
        if (p.origin === 'thealgorithms' && !p.retrievedAt) {
          err('R3', where, 'thealgorithms 来源必须记录 retrievedAt')
        }
        if (p.origin === 'llm' && (!p.model || !p.promptTemplateId)) {
          err('R3', where, 'llm 来源必须记录 model 与 promptTemplateId')
        }
        if (box.review.state === 'draft') {
          draftByLang.set(lang, (draftByLang.get(lang) ?? 0) + 1)
          if (registry.publishPolicy === 'reviewed-only') {
            err('R6', where, 'publishPolicy 为 reviewed-only，draft 不允许进入生产构建')
          }
        } else if (!box.review.reviewedBy) {
          warn('R3', where, `state 为 '${box.review.state}' 但未记录 reviewedBy`)
        }

        /* 覆盖率与索引（只统计已启用语言） */
        coverage[lang]!.have += 1
        const bucket = boxes.get(gid) ?? new Map<string, BoxSource>()
        bucket.set(lang, box)
        boxes.set(gid, bucket)
      }
    }
  }

  /* R20b 覆盖率缺口：清单的每章 × 每个已启用语言，都应有内容文件 */
  for (const c of catalogs) {
    for (const chapter of c.chapters) {
      const missingLangs = enabledLanguageIds.filter(
        (lang) => !content.has(`${lang}/${c.section}/${chapter.id}`),
      )
      if (missingLangs.length) {
        warn(
          'R20',
          `content/languages/*/${c.section}/${chapter.id}.yaml`,
          `这一章还没有这些语言的内容：${missingLangs.join(', ')}（迁移期允许，补齐后这条会消失）`,
        )
      }
    }
  }

  for (const [key, count] of [...vsMissing].sort(([a], [b]) => a.localeCompare(b))) {
    warn(
      'R22',
      key,
      `有 ${count} 处 vs 缺失。基准候选要写除自己外的两门，非基准语言要写全三门 —— 视角无法互相推导，缺的那一份读者看不到`,
    )
  }
  for (const [key, count] of [...suspectedMissing].sort(([a], [b]) => a.localeCompare(b))) {
    warn('R24', key, `有 ${count} 个清单里的 feature 没有内容，也没有声明 absent —— 疑似漏写（刻意留空请写 absent: true）`)
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
    warn('R6', 'content/', `当前 ${total} 条 draft 会进入构建（${detail}）—— 页面上会显示「未经人工校对」标记`)
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
   * 速查三兄弟 —— 唯一保留方向性的内容，归属由 content/pairs/ 的目录名反查得到。
   */
  const { pairs, issues: pairIssues } = loadPairListsV2()
  for (const i of pairIssues) err('R20', i.where, i.message)

  const pitfalls: ScopedPitfall[] = []
  const glossary: ScopedGlossary[] = []
  const roadmaps: Record<string, ScopedRoadmapStage[]> = {}

  for (const pair of pairs) {
    const where = pair.dir
    const allowed = new Set([pair.baseline, pair.target])

    /*
     * featureId 是**软引用**，且搬过来的这批陷阱全指向 v1 的旧 id
     * （`basics-javascript/truthiness` 那种），而 v2 的全局 id 是
     * `<板块>/<章节>/<feature>` —— 悬空是预期的，等 S7 重写对应章节时接上。
     * 所以这里是 warn 而不是 error，且按目录汇总（一个方向动辄十几条）。
     */
    let dangling = 0
    for (const p of pair.pitfalls) {
      pitfalls.push(p)
      if (p.featureId && !featureIndex[p.featureId]) dangling += 1
      for (const lang of p.languages) {
        if (!allLanguageIds.includes(lang)) {
          err('R5', `${where}/pitfalls.yaml#${p.id}`, `语言 '${lang}' 不存在`)
        }
      }
    }
    if (dangling) {
      warn(
        'R5',
        `${where}/pitfalls.yaml`,
        `${dangling} 条陷阱的 featureId 指向旧架构的 id —— S7 重写对应章节时重新指向`,
      )
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
            `perLanguage 含 '${lang}'，但本目录只讲 ${pair.baseline} → ${pair.target}（对级词典只能讲这两门语言）`,
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
    baselineIds,
    metaById,
    catalogs,
    catalogBySection,
    chapterSections,
    features,
    featureIndex,
    content,
    boxes,
    pairs,
    pitfalls,
    glossary,
    roadmaps,
    attributions,
    issues,
    stats: {
      featureCount: features.length,
      boxCount,
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
