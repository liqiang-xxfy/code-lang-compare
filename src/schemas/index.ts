/**
 * 内容契约 —— 唯一真源。
 *
 * 规则（架构定稿 §4.1）：
 *  1. 类型不手写：src/types/index.ts 只做 `z.infer` 再导出，杜绝「手写 interface 与 Zod schema 漂移」。
 *  2. 校验只发生在构建期：src 侧只 `import type`，编译期擦除，不进客户端包。
 */
import { z } from 'zod'

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
  /** 默认基准语言（只有一门应为 true） */
  baseline: z.boolean().default(false),
  links: z.array(resourceLinkSchema).default([]),
  /**
   * 自由扩展位。用于表达「无法塞进通用维度」的语言特性，
   * 例如 ArkTS 的 runtime / supersetOf —— D-D 要求 ArkTS 独立身份可表达。
   */
  metadata: z.record(z.string(), z.string()).optional(),
})

/* ────────────────────────── 内容骨架 ────────────────────────── */

export const featureKindSchema = z.enum(['syntax', 'concept', 'behavior', 'mapping'])

export const featureSchema = z.object({
  /** 全局唯一，约定 '<topic 前缀>/<slug>'，如 'basics/var-declaration' */
  id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, 'featureId 形如 basics/var-declaration'),
  title: z.string().min(1),
  kind: featureKindSchema,
  /** 一句话说明（纯文本，用于列表与 SEO description） */
  summary: z.string().optional(),
  /** 权威说明，受限 Markdown（禁裸 HTML，见 ADR-09） */
  body: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const chapterSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  summary: z.string().optional(),
  /** Feature 内联在 Chapter 里 —— 一个 Chapter 一个文件，避免跨文件 id 同步 */
  features: z.array(featureSchema).min(1),
})

export const topicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  summary: z.string().optional(),
})

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

/** 事实性标注。刻意不含 'differs' / 'no-equivalent' —— 那由 equivalence 推导。 */
export const snippetFlagSchema = z.enum([
  'partial',
  'deprecated',
  'new',
  'experimental',
  'api-only',
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

export const snippetSchema = z.object({
  featureId: z.string().min(1),
  equivalence: equivalenceSchema,
  flags: z.array(snippetFlagSchema).default([]),
  /** 可含内联 @note 标记；构建期抽取后剥离标记 */
  code: z.string().default(''),
  /** 手写运行结果（无 runner，需与代码同等校对） */
  output: z.string().optional(),
  review: reviewRecordSchema,
  /** 该语言的补充说明（受限 Markdown），主要用于 equivalence=absent 时给替代做法 */
  body: z.string().optional(),
})

export const snippetFileSchema = z.array(snippetSchema)

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

export const conceptGroupSchema = z.object({
  id: z.string().min(1),
  concept: z.string().min(1),
  /** N 列 —— 两列视图只是它的一个投影（v1 的 baseline/target 两列装不下 7 语言） */
  entries: z.record(z.string(), z.object({ label: z.string(), detail: z.string() })),
})

export const glossaryTermSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  perLanguage: z.record(z.string(), z.string()),
  note: z.string().optional(),
})

export const roadmapStageSchema = z.object({
  id: z.string().min(1),
  lang: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  durationHint: z.string().optional(),
  todo: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
  resources: z.array(resourceLinkSchema).default([]),
})

/* ────────────────────────── 注册表 ────────────────────────── */

export const languageToggleSchema = z.object({
  enabled: z.boolean().default(false),
})

export const registrySchema = z.object({
  version: z.number().int().positive(),
  /**
   * 发布策略开关（D-A / ADR-07）：
   *  - 'include-draft-with-badge'：draft 参与构建与索引，但页面必须显示「未经人工校对」
   *  - 'reviewed-only'：draft 不进生产构建（校对迭代完成后切回）
   */
  publishPolicy: z.enum(['include-draft-with-badge', 'reviewed-only']),
  baseline: z.string().min(1),
  site: z.object({
    name: z.string().min(1),
    shortDescription: z.string().min(1),
    lang: z.string().default('zh-CN'),
  }),
  languages: z.record(z.string(), languageToggleSchema),
  topics: z.record(
    z.string(),
    z.object({ enabled: z.boolean().default(true), title: z.string().min(1) }),
  ),
})

/* ────────────────────────── 派生类型 ────────────────────────── */

export type ResourceLink = z.infer<typeof resourceLinkSchema>
export type LanguageMeta = z.infer<typeof languageMetaSchema>
export type FeatureKind = z.infer<typeof featureKindSchema>
export type Feature = z.infer<typeof featureSchema>
export type Chapter = z.infer<typeof chapterSchema>
export type Topic = z.infer<typeof topicSchema>
export type Equivalence = z.infer<typeof equivalenceSchema>
export type SnippetFlag = z.infer<typeof snippetFlagSchema>
export type Provenance = z.infer<typeof provenanceSchema>
export type ReviewRecord = z.infer<typeof reviewRecordSchema>
export type SnippetSource = z.infer<typeof snippetSchema>
export type Pitfall = z.infer<typeof pitfallSchema>
export type ConceptGroup = z.infer<typeof conceptGroupSchema>
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>
export type RoadmapStage = z.infer<typeof roadmapStageSchema>
export type Registry = z.infer<typeof registrySchema>

/* ────────────────────────── 构建产物形态（非 YAML 契约） ────────────────────────── */

export interface Annotation {
  line: number
  text: string
  tone: 'info' | 'warn' | 'diff'
}

export interface RenderedSnippet {
  lang: string
  equivalence: Equivalence
  flags: SnippetFlag[]
  /** 原始代码（已剥离 @note 标记），供复制 */
  code: string
  /** Shiki 预高亮 HTML。css-variables 主题下明暗共用一份 */
  html: string
  /** 仅当 css-variables 主题不可用时才存在（ADR-04 降级路径） */
  htmlDark?: string
  lineCount: number
  notes: Annotation[]
  output?: string
  bodyHtml?: string
  reviewState: ReviewRecord['state']
  provenanceOrigin: Provenance['origin']
}

export interface RenderedFeature {
  id: string
  chapterId: string
  title: string
  kind: FeatureKind
  summary?: string
  bodyHtml?: string
  snippets: Record<string, RenderedSnippet>
}

export interface RenderedChapter {
  id: string
  topicId: string
  title: string
  order: number
  summary?: string
  features: RenderedFeature[]
}

export interface TopicPayload {
  topicId: string
  title: string
  summary?: string
  chapters: RenderedChapter[]
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
}

export interface ManifestChapter {
  id: string
  title: string
  order: number
  featureIds: string[]
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
  topics: Array<{ id: string; title: string; chapters: ManifestChapter[] }>
  featureIndex: Record<string, { title: string; chapterId: string; topicId: string }>
  counts: {
    features: number
    snippets: number
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
