/**
 * 内容契约 —— 唯一真源。
 *
 * 规则（架构定稿 §4.1）：
 *  1. 类型不手写：src/types/index.ts 只做 `z.infer` 再导出，杜绝「手写 interface 与 Zod schema 漂移」。
 *  2. 校验只发生在构建期：src 侧只 `import type`，编译期擦除，不进客户端包。
 */
import { z } from 'zod'
import type { SectionId } from '../generated/sections.gen'

/* ────────────────────────── 基础 ────────────────────────── */

export const resourceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
})

/* ────────────────────────── 语言 ────────────────────────── */

export const commentSchema = z.object({
  /** 行注释前缀，如 '//' 或 '#'。驱动 @note 标记解析与 R9 校验。 */
  line: z.string().min(1),
  block: z.tuple([z.string(), z.string()]).optional(),
})

export const languageMetaSchema = z.object({
  /**
   * 以 `_` 开头的 id 是**私有目录**约定（脚手架模板、CI 造的临时语言），
   * 默认构建与校验会跳过它们：
   *   · 脚手架模板供作者复制出新语言，不该被当成一门真语言渲染
   *   · CI 的临时语言若因中断残留，也不会污染校验结果
   * 详见 scripts/lib/core.ts 的 listLanguageIds 与 scripts/verify-extensibility.ts
   */
  id: z.string().regex(/^_?[a-z][a-z0-9-]*$/, 'id 必须是小写 kebab-case（私有目录可加一个前导下划线）'),
  name: z.string().min(1),
  shortName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  /** 内容所依据的语言版本，用于「版本漂移」追踪，页面上会显示「内容基于版本 X」 */
  version: z.string().optional(),
  fileExtension: z.string().startsWith('.'),
  comment: commentSchema,
  /** Shiki 语言标识。ArkTS 无独立语法包 → 用 'typescript'，此处是刻意的近似 */
  shikiLang: z.string().min(1),
  paradigm: z.array(z.string()).default([]),
  typing: z.enum(['dynamic', 'static', 'gradual']),
  typeSystem: z.enum(['structural', 'nominal']).optional(),
  memoryModel: z.enum(['gc', 'arc', 'manual']),
  concurrency: z.array(z.string()).default([]),
  /**
   * 基准候选资格 —— 标 true 表示这门语言可以充当参照系。
   *
   * 刻意允许多门：默认基准只有一门（见 registry 的 defaultBaseline），
   * 但"谁能被选为基准"是站点级策展决策，与"默认选谁"是两件事。
   */
  baseline: z.boolean().default(false),
  links: z.array(resourceLinkSchema).default([]),
  /**
   * 自由扩展位。用于表达「无法塞进通用维度」的语言特性，
   * 例如 ArkTS 的 runtime / supersetOf —— D-D 要求 ArkTS 独立身份可表达。
   */
  metadata: z.record(z.string(), z.string()).optional(),
})

/* ────────────────────────── 内容骨架 ────────────────────────── */

/**
 * 知识点的种类 —— 池里每个 feature 都要声明，用于列表与筛选。
 *
 * `exercise` 是 v1 迁移教程的练习小节留下的取值：v2 已经没有单列板块，
 * 但类型枚举里保留它，免得未来加回「练习」类 feature 时要动 schema。
 */
export const featureKindSchema = z.enum(['syntax', 'concept', 'behavior', 'mapping', 'exercise'])

/**
 * 一个板块的定义 —— `registry.yaml` 的 `sections:` 段的成员。
 *
 * 板块曾是**封闭枚举**（`z.enum(['basics', ...])`），于是加一个板块要改 17 处代码：
 * 路由白名单、路由名 switch、导航分组、首页入口、SEO 分支、搜索文档类型……
 * 其中四处用 `section === 'basics'` 当「是否基准级」的判据，漏改**不报错**，
 * 只是静默按 migration 渲染。
 *
 * 现在板块是可注册的数据，三个正交维度分开声明：
 *   shape    数据形态：chapter = 有章节的并排对照；list = 一页列表资源
 *   scope    是否对级：baseline = 以基准为参照、可多门并列；pair = 锁定两门
 *   columns  语言控件形态：multi = 多选并排；single = 单选
 * 「基准级 + 单选」「对级 + 多选」这类组合在拆分后才成为可表达的状态。
 */
export const sectionDefSchema = z
  .object({
    /** 左栏排序 —— 板块顺序是策展决策，不是字母序 */
    order: z.number().int().nonnegative(),
    /** 侧栏与导航用的短名（如「基础表达」） */
    label: z.string().min(1),
    /** 页面 H1 用的长名（如「基础表达对比」） */
    title: z.string().min(1),
    shape: z.enum(['chapter', 'list']),
    scope: z.enum(['baseline', 'pair']),
    columns: z.enum(['multi', 'single']),
    /**
     * 是不是 `/compare/<基准>` 与顶栏「多语言对比」的落点板块。
     *
     * 写成数据而不是在路由里点名某个板块 id：**站点落点是策展决策**，
     * 换一个板块只该改 registry 一行。写死 id 还会让 `verify:sections` 的白名单
     * 多一条「为什么这里可以出现板块名」的谎话。
     *
     * 至多一个板块声明它（`registrySchema.superRefine` 会拦重复）。
     * 一个都没声明时回落到「第一个章节型板块的首章」（旧行为）。
     */
    landing: z.boolean().optional(),
    /** list 型必填：取自 PairPayload 的哪个字段（pitfalls / glossary / roadmaps） */
    dataKey: z.string().optional(),
    /**
     * list 型必填：渲染器名，指向代码里的渲染器注册表。
     * chapter 型省略即用内置的 ChapterCompareView。
     */
    renderer: z.string().optional(),
    /**
     * SEO 文案模板，构建期求值。占位符：
     *   {baseline} {target} {direction}   语言名与「A → B」
     *   {chapterTitle}                    章节标题（章节型板块）
     *   {compared}                        基准级板块对照的语言名
     *   {count} {sample}                  条目数与前 N 条标题（列表型板块）
     */
    seo: z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      /** {sample} 取前几条标题，默认 8 */
      sampleLimit: z.number().int().positive().optional(),
    }),
  })
  .superRefine((v, ctx) => {
    if (v.shape !== 'list') return
    if (!v.dataKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataKey'],
        message: 'list 型板块必须声明 dataKey —— 它决定从 PairPayload 取哪份列表',
      })
    }
    if (!v.renderer) {
      ctx.addIssue({
        code: 'custom',
        path: ['renderer'],
        message: 'list 型板块必须声明 renderer —— 列表型的交互各不相同，没有默认视图',
      })
    }
  })

/**
 * topic 的板块归属 —— 值为 `registry.sections` 的键。
 *
 * **类型**来自 `src/generated/sections.gen.ts`（随 registry.yaml 自动更新），
 * 所以 `z.infer` 出的 `Section` 仍是「已注册板块」的联合类型，不会退化成 `string` ——
 * 各处 `section: Section` 的赋值照旧受检查。
 *
 * **成员资格**刻意不在这里校验（不用 `z.enum(SECTION_IDS)`）：CI 的顺序是
 * `content:validate → … → content:build`，而 sections.gen.ts 只在 build 阶段重新生成。
 * 若这里依赖生成物，`content:validate` 就会拿**上一版**的板块清单去校验**新**的
 * registry.yaml，新增板块会以「invalid enum value」失败 —— 一个指向错误原因的报错。
 * 因此运行时只保证「是非空字符串」，成员资格交给 `registrySchema.superRefine`
 * 读当次解析的 YAML 判定；生成物是否过期由 section-registry 测试断言。
 */
export const sectionSchema = z.custom<SectionId>(
  (v) => typeof v === 'string' && v.length > 0,
  { message: '板块 id 必须是非空字符串' },
)

/* ────────────────────────── 一格内容 ────────────────────────── */

/**
 * 等价性 —— 唯一的「是否与基准不同」判据（ADR-05）。
 * 手写：只有人能判断「Python 没有 var 提升」这类事实。
 */
export const equivalenceSchema = z.enum([
  'identical', // 同构：语义与写法几乎可直接迁移
  'analogous', // 形似：结构相近但有关键差异
  'divergent', // 语义不同：看起来像但行为不同（迁移陷阱高发区）
  'absent', // 无等价：该语言没有这个概念
])

export const provenanceSchema = z.discriminatedUnion('origin', [
  z.object({
    origin: z.literal('thealgorithms'),
    url: z.string().url(),
    license: z.literal('MIT'),
    author: z.string().optional(),
    retrievedAt: z.string().min(1),
  }),
  z.object({
    origin: z.literal('rosettacode'),
    url: z.string().url(),
    license: z.literal('GFDL-1.2'),
    author: z.string().optional(),
    retrievedAt: z.string().min(1),
  }),
  z.object({
    origin: z.literal('manual'),
    license: z.literal('CC-BY-4.0'),
  }),
  /**
   * LLM 产出不产生可署名许可 —— 刻意不给 license 字段。
   * 强填 MIT/GFDL 是错误陈述，比留空更危险（ADR-08）。
   */
  z.object({
    origin: z.literal('llm'),
    model: z.string().min(1),
    promptTemplateId: z.string().min(1),
    generatedAt: z.string().min(1),
  }),
])

export const reviewRecordSchema = z.object({
  state: z.enum(['draft', 'reviewed', 'verified']).default('draft'),
  provenance: provenanceSchema,
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  /** 校对备注，不面向读者 */
  notes: z.string().optional(),
})

/**
 * 多段代码里的一段。
 *
 * `label` 必填 —— 段标签是并排视图里唯一能说明「第 2 段在跟哪一段比」的东西，
 * 没有它就没法逐段对齐。
 */
export const snippetBlockSchema = z.object({
  label: z.string().min(1),
  code: z.string().default(''),
})

/* ────────────────────────── 踩坑 / 心智模型 / 路线图 ────────────────────────── */

export const pitfallSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  symptom: z.string().min(1),
  cause: z.string().min(1),
  fix: z.string().min(1),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  languages: z.array(z.string()).min(1),
  fromBaseline: z.boolean().default(false),
  featureId: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const glossaryTermSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  perLanguage: z.record(z.string(), z.string()),
  note: z.string().optional(),
})

export const roadmapStageSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  durationHint: z.string().optional(),
  todo: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
  resources: z.array(resourceLinkSchema).default([]),
})

/* ──────────────── 列表资源 × (基准, 目标) 对 ──────────────── */

/**
 * 陷阱 / 词典 / 路线三类列表资源是**对级**的：它们挂在
 * `content/pairs/<基准>2<目标>/` 目录里，归属由目录名决定。
 *
 * 为什么 pair 由 loader 注入而不写进每条 YAML：
 * 12 个对里同一条陷阱可能要出现多次（若它跨多个方向成立），
 * 逐条写 pair 字段会让「同一份内容」变成 12 份会各自漂移的副本。
 */
export const pairContextSchema = z.object({
  baseline: z.string().min(1),
  target: z.string().min(1),
})

export const scopedPitfallSchema = pitfallSchema.extend(pairContextSchema.shape)
export const scopedGlossarySchema = glossaryTermSchema.extend(pairContextSchema.shape)
export const scopedRoadmapStageSchema = roadmapStageSchema.extend(pairContextSchema.shape)

/**
 * 一个方向的 `meta.yaml` —— 速查三兄弟的来源与校对留痕。
 *
 * 三个内容文件（`pitfalls` / `glossary` / `roadmap`）的顶层**是数组**，没有文件级
 * 的容身之处；把顶层改成 `{ review, items }` 会打破沿用至今的旧契约。所以留痕放在
 * **每个方向一份**的 `meta.yaml` 里，与 `languages/<语言>/meta.yaml` 同构。
 *
 * **这一层刻意不接入校验规则**（ADR-66）：它只让字段被解析 —— 三个 pairs schema
 * 都不是 `.strict()`，不写进 schema 的字段会被**静默丢弃**，那才是真正会骗人的形态。
 * 它不代表 R3 / R6 / R17 开始管辖速查内容。
 */
export const pairMetaSchema = z.object({
  review: reviewRecordSchema,
})

/* ────────────────────────── 注册表 ────────────────────────── */

export const languageToggleSchema = z.object({
  enabled: z.boolean().default(false),
})

export const registrySchema = z
  .object({
    version: z.number().int().positive(),
  /**
   * 发布策略开关（D-A / ADR-07）：
   *  - 'include-draft-with-badge'：draft 参与构建与索引，但页面必须显示「未经人工校对」
   *  - 'reviewed-only'：draft 不进生产构建（校对迭代完成后切回）
   */
  publishPolicy: z.enum(['include-draft-with-badge', 'reviewed-only']),
  /** 默认基准语言（首访默认值与 SSG 静态文案使用）。必须是已启用语言 */
  defaultBaseline: z.string().min(1),
  /**
   * 默认对比语言 —— 首访时对比列默认选中的那一门。
   *
   * 取代了 v1 的 `equivalenceReference`：那个常量把徽章的参照系钉死在一门语言上，
   * 于是「以 Python 为基准」时徽章说的仍是「相对 JavaScript」。现在内容按
   * (基准, 目标) 对撰写，徽章相对**该对所属的基准**，参照系随页面而变，
   * 不再需要一个全局常量（ADR-24）。
   */
  defaultCompareLanguage: z.string().min(1),
  site: z.object({
    name: z.string().min(1),
    shortDescription: z.string().min(1),
    lang: z.string().default('zh-CN'),
  }),
    languages: z.record(z.string(), languageToggleSchema),
    /** 板块注册表 —— 左栏分组、URL 段、页面标题、SEO 文案、语言控件形态的唯一来源 */
    sections: z.record(z.string(), sectionDefSchema),
  })
  .superRefine((v, ctx) => {
    /*
     * 板块成员资格的判定落在这里，而不是 `sectionSchema` 的 z.enum ——
     * 因为它读的是**当次解析的 YAML**，永远与 registry.yaml 同步；
     * 若交给生成的 id 清单，content:validate（跑在生成之前）会用上一版清单
     * 校验新内容，新增板块报「invalid enum value」这种指向错误原因的错。
     */
    const ids = new Set(Object.keys(v.sections))
    if (!ids.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'sections 段不能为空 —— 它是左栏、路由与 SEO 文案的来源',
      })
      return
    }
    /*
     * 落点板块至多一个。多个声明不会报错、只会按 order 静默取第一个，
     * 正是「漏改不报错」那一类；这里让它显式失败。
     */
    const landings = Object.entries(v.sections).filter(([, def]) => def.landing)
    if (landings.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `只能有一个板块声明 landing: true，当前有 ${landings.length} 个：${landings
          .map(([id]) => id)
          .join('、')}`,
      })
    }
  })

/* ────────────────────────── 派生类型 ────────────────────────── */

export type ResourceLink = z.infer<typeof resourceLinkSchema>
export type LanguageMeta = z.infer<typeof languageMetaSchema>
export type FeatureKind = z.infer<typeof featureKindSchema>
/** 一个板块的定义（registry.yaml 的 sections 段成员），不含 id */
export type SectionDef = z.infer<typeof sectionDefSchema>
/** 板块 id —— 由 src/generated/sections.gen.ts 派生的联合类型 */
export type Section = z.infer<typeof sectionSchema>
export type Equivalence = z.infer<typeof equivalenceSchema>
export type Provenance = z.infer<typeof provenanceSchema>
export type ReviewRecord = z.infer<typeof reviewRecordSchema>
export type Pitfall = z.infer<typeof pitfallSchema>
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>
export type RoadmapStage = z.infer<typeof roadmapStageSchema>
export type PairContext = z.infer<typeof pairContextSchema>
export type ScopedPitfall = z.infer<typeof scopedPitfallSchema>
export type ScopedGlossary = z.infer<typeof scopedGlossarySchema>
export type ScopedRoadmapStage = z.infer<typeof scopedRoadmapStageSchema>
export type PairMeta = z.infer<typeof pairMetaSchema>
export type Registry = z.infer<typeof registrySchema>

/* ────────────────────────── 构建产物形态（非 YAML 契约） ────────────────────────── */

export interface Annotation {
  line: number
  text: string
  tone: 'info' | 'warn' | 'diff'
}

/** 多段代码里的一段（构建期渲染结果） */
export interface RenderedBlock {
  label: string
  /** 原始代码（已剥离 @note / @note! 标记；高危注记留在行内，说明前带 `⚠`） */
  code: string
  html: string
  htmlDark?: string
  lineCount: number
  /**
   * 该段的高危注记。说明文本已在 `code` 里内联，这里是结构化副本 ——
   * 页面**当前不渲染**（注记不再单独成栏），留作「只看高危」类视图与检索用。
   */
  notes: Annotation[]
}

/**
 * 踩坑的构建期渲染结果。
 * symptom / cause / fix 在源文件里是受限 Markdown，必须在**构建期**渲染成 HTML ——
 * 运行时不做 Markdown 解析，更不允许把 Markdown 原文当 HTML 塞进 v-html（ADR-09）。
 */
export interface RenderedPitfall {
  id: string
  title: string
  symptomHtml: string
  causeHtml: string
  fixHtml: string
  severity: 1 | 2 | 3
  languages: string[]
  fromBaseline: boolean
  featureId?: string
  tags: string[]
  /** 所属 (基准, 目标) 对 */
  baseline: string
  target: string
}

/**
 * 一个 (基准, 目标) 对下的三份列表资源。
 *
 * 按对拆成 12 个文件而不是塞进一个 static.json：内容填满后单文件会静态进主包，
 * 而用户一次只看一个方向。
 */
export interface PairPayload {
  baseline: string
  target: string
  pitfalls: RenderedPitfall[]
  glossary: GlossaryTerm[]
  roadmaps: RoadmapStage[]
}

/** manifest.pairs 的成员 —— 客户端「有哪些方向可去」的单点来源 */
export interface ManifestPair {
  baseline: string
  target: string
  sections: Section[]
}

export interface Manifest {
  generatedAt: string
  publishPolicy: Registry['publishPolicy']
  /** 全部可索引路由 —— prerender 与 sitemap 共用同一来源，保证两者一致 */
  routes: string[]
  /**
   * 预渲染、但**不进 sitemap** 的额外路由。
   *
   * 典型是 `/search`：它对爬虫没有价值（结果是客户端动态渲染的，爬虫只会拿到一个空输入框），
   * 所以 robots.txt 里 Disallow、sitemap 里不出现；但用户会收藏、会深链访问它，
   * 因此仍要预渲染出静态外壳 —— 否则深链要依赖 SPA 回落，首屏白一次。
   */
  prerenderExtra: string[]
  /**
   * 每条路由的 title / description。
   * 由**构建期**产出，这样 finalize-dist 注入静态 HTML 与运行时 usePageMeta
   * 用的是同一份文案，不会出现「爬虫看到的标题和用户看到的不一样」。
   */
  seo: Record<string, { title: string; description: string }>
  /**
   * 板块注册表 —— 客户端据此排左栏、决定语言控件形态（多选 / 单选）、
   * 选渲染器，以及判断「这个板块有没有方向」。与 registry.yaml 的 sections 同源。
   */
  sections: Array<SectionDef & { id: Section }>
  /**
   * 实际存在的 (基准, 目标) 方向。
   *
   * 左栏二级、基准切换的回落、`hasPairSection` 的死链防护三处共用同一份 ——
   * 与 routes 同源，因此不可能出现「导航里有、路由里没有」。
   */
  pairs: ManifestPair[]
  /**
   * 章节树与 feature 索引**不在这里** —— v2 的清单与语言无关，
   * 单独落在 `src/generated/catalog.json`（见 `RenderedCatalog`）。
   * 两者的共同点是「小、可 eager import」，分开是为了让 manifest 只管
   * 路由 / SEO / 板块 / 方向这四件事。
   */
  counts: {
    features: number
    /** 对比框总数（v1 的 snippets） */
    boxes: number
    byState: Record<string, number>
  }
}

export interface AttributionEntry {
  sourceId: string
  /** 站点自有原创内容没有外部 URL */
  url?: string
  license: string
  /** 该许可要求我做什么 */
  obligation: string
  /** 我在哪履行的（可核对的落点，不能是空数组） */
  fulfilledAt: string[]
  usedBy: string[]
}

/** 校验问题。level = 'error' 会阻断 CI 构建 */
export interface Issue {
  rule: string
  level: 'error' | 'warn'
  where: string
  message: string
}

/* ────────────────────────── 内容架构契约 ──────────────────────────
 *
 * 目标形态见 docs/完整项目架构.md。v1 的 schema（`featureSchema` / `chapterSchema` /
 * `topicConfigSchema` / `snippet*` 与它们的 Rendered 接口）已在 S8 清理删除 ——
 * 上面剩下的都是 v2 仍在用的部分。
 *
 * 与旧模型的三处根本差别：
 *   1. 内容是「一门语言相对于当前基准的差异」，所以第 ③ 槽（说明）按角色分成两套：
 *      `baseline`（这门语言作基准列时）与 `vs.<基准 id>`（作对比列时）
 *   2. 清单与内容分离：顺序与标题在 catalog，写法在语言文件
 *   3. 组织单位是语言，不是 (基准, 目标) 方向
 */

/**
 * 全局 feature id —— `<section>/<feature>` **两段**。
 *
 * 四处需要全局唯一键：`featureIndex`、`refFeatureId` 软引用、搜索文档的 id / url、
 * 详情页的路由参数。这四处必须拼同一套，否则详情页 404 或锚点错位，而且**不报错**。
 *
 * **为什么没有章节段**（S6.5）：章节随基准变（每个基准一套章节分类，见 §2.5），
 * 一个 feature 在不同基准下属于不同的章、甚至被某个基准取舍掉 —— 它没有唯一的章。
 * 而它属于**池**，池与基准无关，所以 id 只能由「板块 + feature」构成。
 * 存放组（group）同样是 S6.5 才有的概念，但它是内容的存放细节、界面上看不见，
 * 进 URL 只会多一个读者对不上的段。
 */
export const globalFeatureIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, '全局 feature id 形如 <section>/<feature>')

/** kebab-case 标识 —— 章节 id 与章内 feature id 共用 */
export const kebabIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '必须是小写 kebab-case 标识')

/* ── 清单（catalog/<板块>.yaml） ── */

export const catalogFeatureSchema = z
  .object({
    /** 板块内唯一。全局 id 是 `<section>/<feature>` **两段**（见 globalFeatureIdSchema） */
    id: kebabIdSchema,
    title: z.string().min(1),
    kind: featureKindSchema,
    /** 一句话说明（纯文本，用于列表与 SEO description） */
    summary: z.string().optional(),
    /** 软引用：写**全局** id，可跨章（其存在性由分析期校验） */
    refFeatureId: globalFeatureIdSchema.optional(),
    tags: z.array(z.string()).default([]),
  })
  .strict()

/* ── 清单（S6.5）：feature 池 + 每基准的章节分组 ──
 *
 * 清单从「一份板块一份」拆成两层，因为**章节分类要做成每个基准各一份**：
 *   · 池回答「这个板块有哪些知识点」—— 与基准无关，全站唯一
 *   · 章节分组回答「某个基准怎么把它们讲给读者听」—— 章节名、分组、顺序、取舍都可以不同
 *
 * 两层的接缝是 `group`（**存放组**）：池里的每个 feature 声明自己写进哪个内容文件。
 * 于是同一个 feature 可以在 JS 视角下落在「对象与原型」章、在 Python 视角下落在「类继承」章，
 * **而它的内容只写一份**。存放单位与展示单位由此解耦 —— 这是本层结构的全部收益。
 */

/**
 * 池里的一个 feature —— 在 `catalogFeatureSchema` 之上多一个 `group`。
 *
 * `group` 是**存放组**，即内容文件名：`languages/<语言>/<板块>/<group>.yaml`。
 * 它必须与基准无关，否则「每基准一份章节分类」会退化成「每基准一份内容」。
 */
export const poolFeatureSchema = catalogFeatureSchema
  .extend({ group: kebabIdSchema })
  .strict()

/**
 * feature 池：`content/catalog/<板块>/features.yaml`。
 *
 * 池里的**顺序不表达任何东西** —— 展示顺序全在章节分组里。这里只求好读。
 */
export const featurePoolSchema = z
  .object({
    section: sectionSchema,
    title: z.string().min(1),
    features: z.array(poolFeatureSchema).min(1),
  })
  .strict()

/**
 * 某一基准下的一个章节。
 *
 * 关键性质：`features` 是**池里 feature id 的引用**，
 * 不是内联的 feature 对象 —— 知识点自身的属性（title / kind / …）只该有一份，在池里。
 */
export const baselineChapterSchema = z
  .object({
    /** 该基准下的章节 id。只在「该基准 × 该板块」内唯一 —— 同名不代表同义 */
    id: kebabIdSchema,
    title: z.string().min(1),
    summary: z.string().optional(),
    /** 数组顺序即行顺序。元素是池里的 feature id */
    features: z.array(kebabIdSchema).min(1),
  })
  .strict()

/**
 * 某个基准在某个板块下的章节分组：`content/catalog/<板块>/<基准 id>.yaml`。
 *
 * `section` 与 `baseline` 都必须显式声明并与目录名、文件名一致（R20c）——
 * 这个文件不再能只靠文件名唯一确定自己的身份。
 *
 * **文件缺失 = 该基准在这个板块还没有章节**，视为未开工（左栏整组隐藏），
 * 因此不需要占位文件。
 */
export const baselineCatalogSchema = z
  .object({
    section: sectionSchema,
    baseline: z.string().min(1),
    /** 数组顺序即章节顺序 */
    chapters: z.array(baselineChapterSchema).min(1),
  })
  .strict()

/* ── 内容（languages/<语言>/<板块>/<章节>.yaml） ── */

/**
 * 一个「对比框」—— 一个 feature × 一门语言 = 矩阵里的一格（docs/完整项目架构.md §2.1）。
 *
 * 三个槽位：
 *   ① 代码    `code` / `blocks` 二选一，外加 `output`
 *   ② 注释    代码内联的 `@note` —— 不是字段，它就在 `code` 里
 *   ③ 说明    **按角色分两套**：`baseline`（作基准列）/ `vs.<基准 id>`（作对比列）
 *
 * 三槽全空是合法的，但必须 `absent: true` —— 否则与「忘了写」无法区分。
 * 反向的规则（基准候选必须有 `baseline`、每个基准都要有 `vs`）由分析期管：
 * R22 / R23 是 **error**（硬契约），R24 仍是 warn（「疑似漏写」要人来确认）。
 */
const boxBase = z
  .object({
    /** 单段代码。与 `blocks` 二选一，可含内联 @note 标记 */
    code: z.string().default(''),
    /** 多段对照代码（多段是增量，不是替换 —— 单段继续写 `code`） */
    blocks: z.array(snippetBlockSchema).optional(),
    /** 手写运行结果（无 runner，需与代码同等校对） */
    output: z.string().optional(),
    /** ③-a 本语言作**基准列**时的基础描述：这门语言自己是什么 */
    baseline: z.string().optional(),
    /** ③-b 本语言作**对比列**时的差异解释，key = 当前基准 id */
    vs: z.record(z.string(), z.string()).default({}),
    /** 等价性，key = 当前基准 id；缺 key = identical。基准列不渲染徽章 */
    equivalence: z.record(z.string(), equivalenceSchema).default({}),
    /**
     * 「本语言无此概念」的**结构性**声明，区别于「还没写」。
     *
     * 与 `equivalence` 里语义性的 `absent` 不是一回事：可以同时有 `code`
     * （表示「没有等价语法，这是惯用替代写法」），此时必须有说明。
     */
    absent: z.boolean().default(false),
  })
  .strict()

/**
 * 对比框的校验。
 *
 * R16 有两条断言 —— `code` 与 `blocks` **至多一个**、**至少一个**。
 * 「至多一个」原样保留；「至少一个」**必须删除**：`absent: true` 的格子天然
 * 可以没有代码（「本语言没有变量提升」），强制「至少一个」会让最典型的
 * absent 形态解析失败。它的职责改由分析期的「疑似漏写 / absent 需说明」承担。
 */
function refineBox(v: { code: string; blocks?: Array<{ label: string }> }, ctx: z.RefinementCtx): void {
  if (v.code.trim().length > 0 && (v.blocks?.length ?? 0) > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['blocks'],
      message: 'code 与 blocks 不能并存 —— 单段写 code、多段写 blocks，二选一',
    })
  }
  for (const [i, b] of (v.blocks ?? []).entries()) {
    if (!b.label.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocks', i, 'label'],
        message: '多段的每一段都必须有非空 label —— 否则并排视图无法逐段对齐',
      })
    }
  }
}

/** 对比框（`review` 必填）—— 下游消费的形态 */
export const boxSchema = boxBase.extend({ review: reviewRecordSchema }).superRefine(refineBox)

/** 对比框条目（`review` 可省略，继承文件级默认）—— 语言内容文件里写的是它 */
export const boxEntrySchema = boxBase
  .extend({ review: reviewRecordSchema.optional() })
  .superRefine(refineBox)

/**
 * 一门语言在一个板块下的一章内容。
 *
 * 顶层**不写** language / section / chapter —— 全部由路径派生
 * （docs/完整项目架构.md §3 约定 2）。`.strict()` 让「重复声明」直接报错，
 * 而不是被静默忽略。
 */
export const languageContentFileSchema = z
  .object({
    /** 文件级默认 review，box 级可用自己的覆盖 */
    review: reviewRecordSchema.optional(),
    /** key = catalog 里该章的 feature id */
    boxes: z.record(z.string(), boxEntrySchema),
  })
  .strict()

/* ── v2 构建产物形态（S5 起产出、S6 起消费；此处只定死形状） ── */

/**
 * 一格（一个 feature × 一门语言）的构建期产物。
 *
 * **关键**：第 ① 槽（`code` / `html` / `blocks` / `notes`）是这门语言自己的写法，
 * 与读者当前的基准无关；只有第 ③ 槽随基准变。构建期不知道用户会选哪个基准，
 * 所以两套说明**都预渲染出来**，运行期按当前基准取用：
 *
 * ```
 * 说明 = (lang === 当前基准) ? baselineHtml : vsHtml?.[当前基准]
 * 徽章 = absent                              → ∅（整格「本语言无此概念」）
 *      : (lang === 当前基准)                  → 不渲染（自指、零信息量）
 *      : (equivalence?.[当前基准] ?? 'identical')
 * ```
 *
 * `absent` 必须**短路**掉 `equivalence` 的缺省值：缺 key 默认 `identical`，
 * 于是「本语言无此概念」的格子会顶着一枚 `=` —— 那是错的。
 *
 * 切基准时是同一份数据的**重新取用**，不是重新加载。
 */
export interface RenderedBox {
  lang: string
  /** 原始代码（已剥离 @note / @note! 标记），供复制。高危注记带 `⚠` 前缀，会一并复制 */
  code: string
  /**
   * 多段对照代码；单段内容没有这个字段。
   * 有它时顶层的 code / html / lineCount 是**各段拼接**的结果。
   */
  blocks?: RenderedBlock[]
  /** Shiki 预高亮 HTML。css-variables 主题下明暗共用一份 */
  html: string
  /** 仅当 css-variables 主题不可用时才存在（ADR-04 降级路径） */
  htmlDark?: string
  lineCount: number
  /** 注记的结构化副本 —— 说明已内联在 `code` 里，页面不单独渲染它 */
  notes: Annotation[]
  output?: string
  /** ③-a 本语言作**基准列**时显示的说明 */
  baselineHtml?: string
  /** ③-b 本语言作**对比列**、当前基准为 key 时显示的说明 */
  vsHtml?: Record<string, string>
  /** 按基准的等价性；缺 key = identical。基准列不渲染徽章（自指、零信息量） */
  equivalence: Record<string, Equivalence>
  /** 「本语言无此概念」的显式声明 */
  absent: boolean
  reviewState: ReviewRecord['state']
  provenanceOrigin: Provenance['origin']
}

/**
 * 一个 (语言, 板块, 章节) 分片 —— 分片键 `<语言>/<板块>/<章节>`，
 * 与 `languages/<语言>/<板块>/<章节>.yaml` 一一对应。
 *
 * **它只装一门语言** —— 取代了旧 `RenderedChapter` 的「一章装所有语言」形态。
 * 一个章节页要渲染 N 列，就按可见语言各加载一份分片。
 */
export interface RenderedBoxChapter {
  lang: string
  section: Section
  /** **存放组**，不是展示章 —— 展示章随基准变，它不随（见 `poolFeatureSchema.group`） */
  group: string
  /** key = 池里该存放组的 feature id */
  boxes: Record<string, RenderedBox>
}

/**
 * 构建产物里的一章。
 *
 * 源文件（`baselineChapterSchema`）里 `features` 只是**池里的 id 引用**；构建期把池的字段
 * join 进来，于是视图读 `feature.title` / `kind` / `summary` 的代码一行都不用改。
 * `features` 的元素类型是 `PoolFeature`（比 `CatalogFeature` 多一个 `group`）——
 * 运行时正是靠它把「这一行」映射到「哪个内容分片」。
 */
export interface CatalogChapter {
  id: string
  title: string
  summary?: string
  /** 数组顺序即行顺序 */
  features: PoolFeature[]
}

/** 某个基准在某个板块下的章节分组（构建期已 join 池字段） */
export interface RenderedBaselineCatalog {
  section: Section
  baseline: string
  chapters: CatalogChapter[]
}

/**
 * 清单产物 `src/generated/catalog.json` —— 与语言无关、小、可 eager import。
 *
 * 两层结构（S6.5）：`catalogs` 是**每基准一份**的章节分组（决定左栏与矩阵的行），
 * `featureIndex` 是**与基准无关**的知识点索引（详情页、锚点、搜索共用）。
 */
export interface RenderedCatalog {
  generatedAt: string
  catalogs: RenderedBaselineCatalog[]
  /**
   * key = 全局 feature id `<section>/<feature>`。
   *
   * `group` 是详情页唯一的取数依据（box 与基准无关，只由 feature 决定）；
   * `summary` / `refFeatureId` 一并带上，详情页因此不必再持有一份池。
   */
  featureIndex: Record<
    string,
    {
      title: string
      section: Section
      group: string
      kind: FeatureKind
      summary?: string
      refFeatureId?: string
      tags: string[]
    }
  >
}

/* ── v2 派生类型 ── */

export type GlobalFeatureId = z.infer<typeof globalFeatureIdSchema>
export type CatalogFeature = z.infer<typeof catalogFeatureSchema>
/** 池里的一个知识点 = feature 自身的属性 + 存放组（S6.5） */
export type PoolFeature = z.infer<typeof poolFeatureSchema>
/** feature 池：`catalog/<板块>/features.yaml`（S6.5） */
export type FeaturePool = z.infer<typeof featurePoolSchema>
export type BaselineChapter = z.infer<typeof baselineChapterSchema>
/** 某基准在某板块下的章节分组：`catalog/<板块>/<基准 id>.yaml`（S6.5） */
export type BaselineCatalog = z.infer<typeof baselineCatalogSchema>
/** 对比框，`review` 已必填（下游消费用） */
export type BoxSource = z.infer<typeof boxSchema>
/** 对比框条目，`review` 可省略（语言内容文件里写的形态） */
export type BoxEntry = z.infer<typeof boxEntrySchema>
export type LanguageContentFile = z.infer<typeof languageContentFileSchema>
