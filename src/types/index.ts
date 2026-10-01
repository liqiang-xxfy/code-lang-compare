/**
 * 应用层类型出口。
 *
 * 只做两件事：
 *  1. 把内容契约（Zod schema 推导出的类型）以 **type-only** 方式再导出；
 *  2. 导出由 registry 生成的 LanguageId 等标识类型。
 *
 * `export type *` 是编译期擦除的，zod 不会被带进客户端包。
 */
export type * from '../schemas'
export type {
  AllLanguageId,
  EnabledLanguageId,
  LanguageId,
} from '../generated/registry.gen'
