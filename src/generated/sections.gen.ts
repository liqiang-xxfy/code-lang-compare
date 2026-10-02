/* eslint-disable */
/*
 * AUTO-GENERATED FILE — 请勿手工编辑。
 * 源：content/registry.yaml 的 sections 段
 * 重新生成：npm run registry（npm run content:build 会自动执行）
 * 生成时间：2026-10-02T10:27:39.111Z
 */

/** 全部已注册板块，按 registry 的 order 排序。左栏顺序读它 */
export const SECTION_IDS = ['roadmap', 'basics', 'concepts', 'migration', 'pitfalls', 'glossary'] as const

/**
 * 板块 id 的联合类型。
 *
 * 这是**唯一**的板块类型来源 —— `src/schemas` 的 `Section` 就是它的别名。
 * 它随 registry.yaml 的 sections 段自动更新，因此「加一个板块」不需要改任何类型代码。
 */
export type SectionId = (typeof SECTION_IDS)[number]

/** 运行时判定：这个字符串是不是一个已注册的板块（路由守卫分流用） */
export const isSectionId = (v: string): v is SectionId =>
  (SECTION_IDS as readonly string[]).includes(v)
