/**
 * 内容分析与校验（v2.1）—— validate 与 build 共用同一份装载/合并/检查逻辑。
 *
 * 为什么要共用：如果校验用一套装载、构建用另一套，「校验通过但构建出问题」
 * 就是必然结果。这里保证两者看到的内容完全一致。
 *
 * 清单是**两层**的（S6.5，docs/完整项目架构.md §2.5）：
 *   · feature 池 `catalog/<板块>/features.yaml` —— 有哪些知识点，与基准无关，全站唯一
 *   · 章节分组 `catalog/<板块>/<基准 id>.yaml` —— 某基准怎么把它们讲给读者听
 * 接缝是 `group`（存放组）：内容的归属，与展示章解耦。
 *
 * **最承重的一条**：`features` / `featureIndex` 必须**从池构建**，不能遍历章节分组 ——
 * 同一批知识点会被每个基准各引用一次，遍历分组等于把每个 feature 数三遍。
 */
import type {
  BaselineCatalog,
  BoxSource,
  FeatureKind,
  FeaturePool,
  Issue,
  LanguageMeta,
  PoolFeature,
  Registry,
  ScopedGlossary,
  ScopedPitfall,
  ScopedRoadmapStage,
} from '../../src/schemas'
import {
  extractNotes,
  groupsOfPool,
  isSafeUrl,
  listLanguageGroupFiles,
  listLanguageIds,
  loadAllLanguageMeta,
  loadBaselineCatalogs,
  loadFeaturePools,
  loadPairListsV2,
  loadPoolLanguageContent,
  loadRegistry,
  type LanguageGroupContent,
  type PairListsV2,
} from './core'

/* ────────────────────────── 分析结果 ────────────────────────── */

/**
 * 全局 feature id = `<板块>/<feature>` —— 四处消费者必须拼同一套。
 *
 * 没有章节段：章节随基准变，feature 没有唯一的章；也没有存放组：它是界面上看不见的
 * 存放细节。见 `globalFeatureIdSchema` 的注释。
 */
export const globalIdOf = (section: string, feature: string): string => `${section}/${feature}`

export interface FeatureEntry {
  feature: PoolFeature
  section: string
  /** 存放组 —— 内容文件的第三段 */
  group: string
  id: string
}

/** 构建产物里的知识点索引条目 —— 详情页与搜索共用，因此带上 summary / refFeatureId */
export interface FeatureIndexEntry {
  title: string
  section: string
  group: string
  kind: FeatureKind
  summary?: string
  refFeatureId?: string
  tags: string[]
}

export interface Analysis {
  registry: Registry
  metas: LanguageMeta[]
  allLanguageIds: string[]
  enabledLanguageIds: string[]
  /** 基准候选（固定三门）—— `vs` 的 key 集合由它决定 */
  baselineIds: string[]
  metaById: Record<string, LanguageMeta>
  /** 每个板块一个池 —— 与基准无关 */
  pools: FeaturePool[]
  poolBySection: Record<string, FeaturePool>
  /** 每基准一份的章节分组 */
  catalogs: BaselineCatalog[]
  /** key = `<基准 id>/<板块>` */
  catalogOf: Record<string, BaselineCatalog>
  /** 有池的板块（= 章节型板块） */
  chapterSections: string[]
  features: FeatureEntry[]
  /** key = 全局 id `<板块>/<feature>` */
  featureIndex: Record<string, FeatureIndexEntry>
  /** 全局 id → 引用了它的基准列表（R22/R23/R24 的求值域） */
  referencedBy: Record<string, string[]>
  /** key = `<语言>/<板块>/<存放组>` */
  content: Map<string, LanguageGroupContent>
  /** 全局 id -> 语言 -> 对比框 */
  boxes: Map<string, Map<string, BoxSource>>
  /** 按 (基准, 目标) 分组的三份列表资源 */
  pairs: PairListsV2[]
  pitfalls: ScopedPitfall[]
  glossary: ScopedGlossary[]
  /** key = `${baseline}|${target}` */
  roadmaps: Record<string, ScopedRoadmapStage[]>
  issues: Issue[]
  stats: {
    featureCount: number
    boxCount: number
    byState: Record<string, number>
    /** key = 语言；have = 该语言写了框的 feature 数，total = 池里的 feature 总数 */
    coverage: Record<string, { have: number; total: number }>
  }
}

/** 三槽全空？ */
const isEmptyBox = (b: BoxSource): boolean =>
  !b.code.trim() &&
  !(b.blocks?.length ?? 0) &&
  !b.baseline?.trim() &&
  Object.values(b.vs).every((v) => !v.trim())

/** 池里每个存放组各含哪些 feature id */
function membersByGroup(pool: FeaturePool): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const f of pool.features) {
    const set = out.get(f.group) ?? new Set<string>()
    set.add(f.id)
    out.set(f.group, set)
  }
  return out
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
   * 基准固定为三门（ADR-47）：加一个基准等于让**每一门语言**各补一份差异说明，
   * 是 N 倍成本；定死之后 `vs` 的 key 集合封闭，内容总量可预估。
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

  /* ── 池与章节分组 ── */
  const { pools, issues: poolIssues } = loadFeaturePools()
  for (const i of poolIssues) err('R20c', i.where, i.message)

  const poolBySection: Record<string, FeaturePool> = {}
  for (const p of pools) {
    if (!(p.section in registry.sections)) {
      err('R20c', `content/catalog/${p.section}/features.yaml`, `板块 '${p.section}' 不在 registry.yaml 的 sections 段里`)
    }
    poolBySection[p.section] = p
  }
  const chapterSections = pools.map((p) => p.section)

  const { catalogs, issues: catalogIssues } = loadBaselineCatalogs(baselineIds)
  for (const i of catalogIssues) err('R20c', i.where, i.message)

  const catalogOf: Record<string, BaselineCatalog> = {}
  for (const c of catalogs) {
    const key = `${c.baseline}/${c.section}`
    if (catalogOf[key]) {
      err('R20c', `content/catalog/${c.section}/${c.baseline}.yaml`, `${key} 有不止一份章节分组`)
    }
    if (!(c.section in poolBySection)) {
      err(
        'R20c',
        `content/catalog/${c.section}/${c.baseline}.yaml`,
        `板块 '${c.section}' 没有 feature 池 —— 章节分组引用的知识点无处解析`,
      )
    }
    catalogOf[key] = c
  }

  /*
   * ── 知识点清单：**从池构建** ──
   *
   * 这是本文件最承重的一处：遍历章节分组会把同一批 feature 按基准数重复插入，
   * 于是 R20 报「全局 feature id 重复」、featureCount 也翻倍。
   */
  const features: FeatureEntry[] = []
  const featureIndex: Analysis['featureIndex'] = {}
  const referencedBy: Analysis['referencedBy'] = {}
  for (const pool of pools) {
    const seen = new Set<string>()
    for (const f of pool.features) {
      if (seen.has(f.id)) {
        err('R20b', `content/catalog/${pool.section}/features.yaml`, `feature id 重复：${f.id}`)
      }
      seen.add(f.id)
      const id = globalIdOf(pool.section, f.id)
      features.push({ feature: f, section: pool.section, group: f.group, id })
      featureIndex[id] = {
        title: f.title,
        section: pool.section,
        group: f.group,
        kind: f.kind,
        ...(f.summary ? { summary: f.summary } : {}),
        ...(f.refFeatureId ? { refFeatureId: f.refFeatureId } : {}),
        tags: f.tags,
      }
    }
  }

  /* 章节分组：引用合法性（R20a）、同基准重复（R20h）、章内 id 唯一 */
  for (const c of catalogs) {
    const pool = poolBySection[c.section]
    const where = `content/catalog/${c.section}/${c.baseline}.yaml`
    const chapterIds = new Set<string>()
    for (const chapter of c.chapters) {
      if (chapterIds.has(chapter.id)) {
        err('R20c', where, `章节 id 重复：${chapter.id}`)
      }
      chapterIds.add(chapter.id)
      const inChapter = new Set<string>()
      for (const fid of chapter.features) {
        const gid = globalIdOf(c.section, fid)
        if (pool && !pool.features.some((f) => f.id === fid)) {
          err('R20a', where, `章节 '${chapter.id}' 引用了池里不存在的 feature：${fid}`)
          continue
        }
        if (inChapter.has(fid)) {
          err('R20h', where, `章节 '${chapter.id}' 里 feature 重复：${fid}`)
        }
        inChapter.add(fid)
        const list = (referencedBy[gid] ??= [])
        if (list.includes(c.baseline)) {
          warn('R20h', where, `'${fid}' 在 ${c.baseline} 视角下出现在多个章节里`)
        } else {
          list.push(c.baseline)
        }
      }
    }
  }

  /* R20e 池里有、但没有被任何基准的章节分组引用 → 永远不会被展示 */
  for (const f of features) {
    if (!referencedBy[f.id]) {
      warn(
        'R20e',
        `content/catalog/${f.section}/features.yaml`,
        `'${f.feature.id}' 没有被任何基准的章节分组引用 —— 它永远不会出现在页面上`,
      )
    }
  }

  /* R5 软引用 —— refFeatureId 写的是全局 id，可跨板块 */
  for (const f of features) {
    const ref = f.feature.refFeatureId
    if (!ref) continue
    if (ref === f.id) {
      err('R5', `content/catalog/${f.section}/features.yaml`, `feature '${f.id}' 的 refFeatureId 指向自己`)
    } else if (!featureIndex[ref]) {
      err('R5', `content/catalog/${f.section}/features.yaml`, `feature '${f.id}' 的 refFeatureId '${ref}' 不存在`)
    }
  }

  /* ── 语言内容（由池的存放组驱动） ── */
  const content = new Map<string, LanguageGroupContent>()
  const boxes = new Map<string, Map<string, BoxSource>>()
  const byState: Record<string, number> = {}
  const draftByLang = new Map<string, number>()
  const coverage: Record<string, { have: number; total: number }> = {}
  for (const lang of enabledLanguageIds) coverage[lang] = { have: 0, total: features.length }

  // 逐条会刷屏的规则一律按 (语言, 板块) 汇总成一条 —— 把真正要看的 error 埋掉才是灾难
  const vsMissing = new Map<string, number>()
  const suspectedMissing = new Map<string, number>()
  const chapterGap = new Map<string, number>()
  const baselineGap = new Map<string, number>()
  let boxCount = 0

  for (const lang of dirIds) {
    const meta = metaById[lang]
    if (!meta) continue
    const isCandidate = baselineIds.includes(lang)
    const isEnabled = enabledLanguageIds.includes(lang)
    const commentLine = meta.comment.line

    /* R20d 孤儿文件：语言目录里存在、但存放组不在池里（拼错或孤儿） */
    const knownGroups = new Set<string>()
    for (const pool of pools) {
      for (const g of groupsOfPool(pool)) knownGroups.add(`${pool.section}/${g}`)
    }
    for (const f of listLanguageGroupFiles(lang)) {
      if (!knownGroups.has(`${f.section}/${f.group}`)) {
        err(
          'R20d',
          f.file,
          `池里没有 '${f.section}/${f.group}' 这个存放组 —— 板块目录名或文件名写错了，这份内容不会被渲染`,
        )
      }
    }

    for (const g of loadPoolLanguageContent(lang, pools)) {
      content.set(`${lang}/${g.section}/${g.group}`, g)
      const pool = poolBySection[g.section]
      if (!pool) continue
      const members = membersByGroup(pool).get(g.group) ?? new Set<string>()

      /* R21 key 合法性 —— boxes 是 z.record，key 全靠这条兜底 */
      for (const key of Object.keys(g.boxes)) {
        if (!members.has(key)) {
          err(
            'R21',
            g.file,
            `box '${key}' 不在池的 '${g.section}/${g.group}' 存放组里（拼写错误或孤儿条目）`,
          )
        }
      }

      for (const [featureId, box] of Object.entries(g.boxes)) {
        if (!members.has(featureId)) continue // 已在 R21 报过，不再连带报别的
        const gid = globalIdOf(g.section, featureId)
        const refs = referencedBy[gid]
        const isReferenced = Boolean(refs?.length)

        /* R4/R9 注记标记必须被解析干净 */
        const code = box.blocks?.length ? box.blocks.map((b) => b.code).join('\n') : box.code
        if (code.trim()) {
          const extracted = extractNotes(code, commentLine)
          if (/@note/.test(extracted.code)) {
            err(
              'R4/R9',
              `${g.file} → ${featureId}`,
              `代码里残留 @note 标记 —— 两个条件都要满足：① 写在注释前缀（'${commentLine}'）之后；② 标记之后要有一个空白字符（\`@note 说明\` 而不是 \`@note说明\`）`,
            )
          }
        }

        /* R22 vs 完整性 —— 只对**被某个基准引用**的知识点求值 */
        if (isReferenced) {
          const required = isCandidate ? baselineIds.filter((b) => b !== lang) : baselineIds
          const missing = required.filter((b) => !box.vs[b]?.trim())
          if (missing.length && isEnabled) {
            const k = `${lang} · ${g.section}`
            vsMissing.set(k, (vsMissing.get(k) ?? 0) + missing.length)
          }
        }

        /*
         * R23 基准列的 baseline 不可空 —— 只对**该基准自己引用了的**知识点。
         *
         * S8 把它从 warn 翻成 error：这是**硬契约**（基准列是参照系，空着就是坏页），
         * 不存在「合法地留空」这种情形 —— 真无话可说说明这条 feature 不该进池。
         * 与之相对，R24 仍是 warn（理由见那条的注释）。
         */
        if (isCandidate && isEnabled && refs?.includes(lang) && !box.baseline?.trim()) {
          err(
            'R23',
            `${g.file} → ${featureId}`,
            `'${lang}' 是基准候选，${lang} 的章节分组引用了这个知识点，但它缺 baseline 说明（基准列不能空着）`,
          )
        }

        /* R26 absent 且给了代码（惯用替代写法）→ 必须有说明 */
        const hasExplain = Boolean(box.baseline?.trim()) || Object.values(box.vs).some((v) => v.trim())
        if (box.absent && (box.code.trim() || (box.blocks?.length ?? 0)) && !hasExplain) {
          warn(
            'R26',
            `${g.file} → ${featureId}`,
            'absent 的格子给了代码（惯用替代写法），但没有 baseline / vs 说明 —— 读者无从知道这是「没有等价语法」而非「写法不同」',
          )
        }

        if (!isEnabled) continue

        /* R17 校对状态升级需留记录 */
        if (box.review.state !== 'draft' && (!box.review.reviewedBy || !box.review.reviewedAt)) {
          warn('R17', g.file, `'${featureId}' 标为 ${box.review.state}，但缺少 reviewedBy / reviewedAt`)
        }

        /* R6 发布门槛 */
        const where = `${gid} · ${lang}`
        byState[box.review.state] = (byState[box.review.state] ?? 0) + 1
        boxCount += 1

        if (box.review.state === 'draft') {
          draftByLang.set(lang, (draftByLang.get(lang) ?? 0) + 1)
          if (registry.publishPolicy === 'reviewed-only') {
            err('R6', where, 'publishPolicy 为 reviewed-only，draft 不允许进入生产构建')
          }
        }

        /* 覆盖率与索引（只统计已启用语言） */
        coverage[lang]!.have += 1
        const bucket = boxes.get(gid) ?? new Map<string, BoxSource>()
        bucket.set(lang, box)
        boxes.set(gid, bucket)
      }
    }
  }

  /* R20f 悬空存放组：池里声明了，但没有任何已启用语言写这个文件 */
  for (const pool of pools) {
    for (const group of groupsOfPool(pool)) {
      const hasAny = enabledLanguageIds.some((lang) => content.has(`${lang}/${pool.section}/${group}`))
      if (!hasAny) {
        warn(
          'R20f',
          `content/languages/*/${pool.section}/${group}.yaml`,
          `存放组 '${group}' 在池里声明了，但没有任何已启用语言写它的内容`,
        )
      }
    }
  }

  /*
   * R20g 覆盖率缺口 / R27 基准列空洞 —— 都按「章引用了哪些存放组」来算。
   * 逐条会刷屏，因此各自按 (基准, 板块) 与 (语言, 板块) 汇总。
   */
  for (const c of catalogs) {
    const pool = poolBySection[c.section]
    if (!pool) continue
    for (const chapter of c.chapters) {
      const groups = new Set<string>()
      for (const fid of chapter.features) {
        const f = pool.features.find((x) => x.id === fid)
        if (f) groups.add(f.group)
      }
      if (!groups.size) continue

      /* R27：基准自己缺某个被引用的存放组 → 基准列会出现空洞 */
      const missingInBaseline = [...groups].filter(
        (g) => !content.has(`${c.baseline}/${c.section}/${g}`),
      )
      if (missingInBaseline.length) {
        const k = `${c.baseline} · ${c.section}`
        baselineGap.set(k, (baselineGap.get(k) ?? 0) + missingInBaseline.length)
      }

      /* R20g：某个语言在这一章引用的存放组里一个都没写 */
      for (const lang of enabledLanguageIds) {
        if ([...groups].some((g) => content.has(`${lang}/${c.section}/${g}`))) continue
        const k = `${lang} · ${c.section}`
        chapterGap.set(k, (chapterGap.get(k) ?? 0) + 1)
      }
    }
  }

  /*
   * R24 存疑的空框 —— 池里有、被某个基准引用、但这门语言没写 key（或三槽全空且未 absent）。
   * 与旧的差别：判据从「清单的每一章」变成「被引用的每一个知识点」。
   */
  for (const lang of enabledLanguageIds) {
    for (const f of features) {
      if (!referencedBy[f.id]) continue
      const box = boxes.get(f.id)?.get(lang)
      const where = `${lang} · ${f.section}`
      if (!box) {
        suspectedMissing.set(where, (suspectedMissing.get(where) ?? 0) + 1)
      } else if (!box.absent && isEmptyBox(box)) {
        suspectedMissing.set(where, (suspectedMissing.get(where) ?? 0) + 1)
      }
    }
  }

  /*
   * R22 也是硬契约，S8 从 warn 翻成 error：视角无法互相推导，缺的那一份
   * 读者永远看不到。注意它的求值域含**已启用但还没写内容**的语言 ——
   * 新启一门语言时它会立刻红，这是刻意要的：宁可让人在 registry 里
   * 显式写 `enabled: false`，也不要上一列空白。
   */
  for (const [key, count] of [...vsMissing].sort(([a], [b]) => a.localeCompare(b))) {
    err(
      'R22',
      key,
      `有 ${count} 处 vs 缺失。基准候选要写除自己外的两门，非基准语言要写全三门 —— 视角无法互相推导，缺的那一份读者看不到`,
    )
  }
  /*
   * R24 **刻意保持 warn**（与 R22 / R23 不同，S8 没有翻它）。
   *
   * 它判的是「键缺失、且没标 absent」—— 可是**空框本身是合法的**（§4.4）：
   * 内容天然疏密不均，某门语言在这个知识点上无话可说很正常，不必为此撒一个
   * `absent: true`（那是另一个意思：「本语言没有这个概念」）。翻成 error 会逼作者
   * 在「还没写」与「本来就没有」之间二选一，而那恰恰是这个字段设计出来要区分的两件事。
   * 它是一条**提醒人去确认**的规则，不是一条可以自动判定对错的规则。
   */
  for (const [key, count] of [...suspectedMissing].sort(([a], [b]) => a.localeCompare(b))) {
    warn('R24', key, `有 ${count} 个被基准引用的知识点没有内容，也没有声明 absent —— 疑似漏写（刻意留空请写 absent: true）`)
  }
  for (const [key, count] of [...chapterGap].sort(([a], [b]) => a.localeCompare(b))) {
    warn('R20g', key, `有 ${count} 章这一门语言一个存放组都没写 —— 它在这些章里会整列留白`)
  }
  for (const [key, count] of [...baselineGap].sort(([a], [b]) => a.localeCompare(b))) {
    warn('R27', key, `有 ${count} 处「章节引用了某个存放组、但基准自己没写」—— 基准列会出现空洞`)
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

  /*
   * 速查三兄弟 —— 唯一保留方向性的内容，归属由 content/pairs/ 的目录名反查得到。
   */
  const { pairs, issues: pairIssues } = loadPairListsV2()
  for (const i of pairIssues) err('R20c', i.where, i.message)

  const pitfalls: ScopedPitfall[] = []
  const glossary: ScopedGlossary[] = []
  const roadmaps: Record<string, ScopedRoadmapStage[]> = {}

  for (const pair of pairs) {
    const where = pair.dir
    const allowed = new Set([pair.baseline, pair.target])

    /*
     * 对级陷阱与对级词典都只允许讲这一个方向的两门语言（ADR-68）。
     * 多一门第三语言，读者会以为「带着当前基准的习惯」也会在那里踩到同样的坑 ——
     * 而这条内容根本没在讲那个方向。
     *
     * `featureId` 则是**软引用**：断了只是「陷阱 → 特性」那条反查链断掉，陷阱本身照常
     * 渲染，所以是 warn 而不是 error，且按目录汇总（一个方向动辄十几条）。
     * 悬空最常见的成因是 feature 改名或被某个基准取舍了 —— 那是可以合法发生的，不是写错。
     */
    let dangling = 0
    for (const p of pair.pitfalls) {
      pitfalls.push(p)
      if (p.featureId && !featureIndex[p.featureId]) dangling += 1
      for (const lang of p.languages) {
        if (!allLanguageIds.includes(lang)) {
          err('R5', `${where}/pitfalls.yaml#${p.id}`, `语言 '${lang}' 不存在`)
        } else if (!allowed.has(lang)) {
          err(
            'R5',
            `${where}/pitfalls.yaml#${p.id}`,
            `languages 含 '${lang}'，但本目录只讲 ${pair.baseline} → ${pair.target}（陷阱只能讲这两门语言）`,
          )
        }
      }
    }
    if (dangling) {
      warn(
        'R5',
        `${where}/pitfalls.yaml`,
        `${dangling} 条陷阱的 featureId 在 featureIndex 里查不到 —— 那条「相关特性」反查链会断`,
      )
    }

    /*
     * 词典的 `perLanguage` 是数据键，多一门就是多一列；判据与上面的陷阱同源。
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
    pools,
    poolBySection,
    catalogs,
    catalogOf,
    chapterSections,
    features,
    featureIndex,
    referencedBy,
    content,
    boxes,
    pairs,
    pitfalls,
    glossary,
    roadmaps,
    issues,
    stats: {
      featureCount: features.length,
      boxCount,
      byState,
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
