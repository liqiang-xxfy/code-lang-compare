/**
 * 部署相关环境变量的统一解析。
 *
 * 两件事：
 *  1. **命名空间化**：用 PC_ 前缀。BASE_PATH / SITE_URL 这类名字过于通用，
 *     宿主环境（CI、编辑器、终端集成）常常预设一个无关的同名变量，静默污染构建。
 *
 *  2. **防 MSYS 路径转换**：在 Windows 的 Git Bash / MSYS2 里，把环境变量传给原生程序时，
 *     值以 `/` 开头会被**自动改写**成 MSYS 根目录的 Windows 绝对路径：
 *
 *        PC_BASE_PATH=/            →  C:/Users/xxx/.workbuddy/.../PortableGit/versions/1.2.0
 *        PC_BASE_PATH=/my-repo/    →  C:/Users/xxx/.../versions/1.2.0/my-repo/
 *
 *     结果就是 base 变成一个荒谬的绝对路径，Vite 报
 *     `"base" option should start with a slash` 然后构建失败（这个坑实测踩到过）。
 *
 *     所以本模块**推荐不带前导斜杠的写法**：
 *        PC_BASE_PATH=code-lang-compare        ← 推荐，任何 shell 都不会改写
 *        PC_BASE_PATH=/code-lang-compare/      ← 也可，但需 MSYS_NO_PATHCONV=1
 *
 *     并识别出已被改写的值，给出可执行的修复提示，而不是留下一个静默错误的产物。
 */

export interface ResolveResult {
  value: string
  /** 发生了什么需要提示用户的事；调用方决定打印时机与方式 */
  warning?: string
}

/** 形如 C:/... 或 C:\... —— 说明值已经被 MSYS 转换过 */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/

export function resolveBasePath(): ResolveResult {
  const raw = (process.env.PC_BASE_PATH ?? '').trim()

  if (!raw) return { value: '/' }

  if (WINDOWS_ABSOLUTE.test(raw)) {
    return {
      value: '/',
      warning:
        `PC_BASE_PATH 收到了一个 Windows 绝对路径（${raw}）。\n` +
        '        这几乎一定是 Git Bash / MSYS2 的自动路径转换：以 "/" 开头的环境变量会被改写成 MSYS 根目录。\n' +
        '        修复方式（二选一）：\n' +
        '          · 去掉前导斜杠：PC_BASE_PATH=code-lang-compare\n' +
        '          · 或关闭转换：   MSYS_NO_PATHCONV=1 PC_BASE_PATH=/code-lang-compare/\n' +
        '        已回退为 "/"。',
    }
  }

  let value = raw.replace(/^\.\//, '')
  if (!value.startsWith('/')) value = `/${value}`
  if (!value.endsWith('/')) value = `${value}/`
  return { value }
}

export function resolveSiteUrl(): ResolveResult {
  const raw = (process.env.PC_SITE_URL ?? '').trim()
  if (!raw) return { value: '' }
  const value = raw.replace(/\/+$/, '')
  if (!/^https:\/\//.test(value)) {
    return {
      value: '',
      warning: `PC_SITE_URL 必须是 https:// 开头（收到 ${raw}），已忽略。canonical 与 sitemap 宁可不生成，也不写错误地址。`,
    }
  }
  return { value }
}
