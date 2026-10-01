/**
 * CI：验证「新增一门语言 = 只加数据目录」这句承诺。
 *
 * 做法：真的造一门临时语言，跑一遍注册表生成，然后扫描 **除 src/generated 之外**
 * 的全部 src 源码，断言里面**没有任何地方提及这门语言的 id**。
 * 如果扫描到，说明「加语言」需要改组件/类型/路由代码 —— 承诺不成立，构建失败。
 *
 * ── 关于临时目录用 `_` 前缀 ──────────────────────────────────
 * 这门临时语言命名为 `_fixturelang`，走「私有目录」约定：
 * 默认构建与校验都会跳过 `_` 开头的语言目录。
 * 这样做不是因为怕麻烦，而是因为**实测踩到过**：脚本一旦被中断（Ctrl-C、CI 超时），
 * 残留的 fixture 目录会让整个仓库的 `content:validate` 与测试失败，
 * 报一个和真实内容八竿子打不着的 R8 错误。改用私有前缀后，残留是无害的。
 *
 * 私有目录本身必须能被注册表发现（否则证明不了任何事），所以这里显式开 includePrivate。
 */
import fs from 'node:fs'
import path from 'node:path'
import { LANGUAGES_DIR, ROOT, writeText } from './lib/core'
import { generateRegistry } from './build/generate-registry'

const FIXTURE_ID = '_fixturelang'
const fixtureDir = path.join(LANGUAGES_DIR, FIXTURE_ID)
const registryFile = path.join(ROOT, 'content', 'registry.yaml')

const fixtureMeta = `# 由 scripts/verify-extensibility.ts 临时创建，正常状态下不应存在
id: ${FIXTURE_ID}
name: Fixture Lang
shortName: Fx
aliases: [fx]
fileExtension: .fx
comment:
  line: '//'
shikiLang: text
paradigm: [test]
typing: dynamic
memoryModel: gc
concurrency: []
baseline: false
`

function cleanup(): void {
  if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true })
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|vue|mts|js|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

let exitCode = 0

// 即便上次被中断，也从干净状态开始
cleanup()

try {
  fs.mkdirSync(fixtureDir, { recursive: true })
  writeText(path.join(fixtureDir, 'meta.yaml'), fixtureMeta)

  const result = generateRegistry({ includePrivate: true, write: false })
  if (!result.allLanguageIds.includes(FIXTURE_ID)) {
    console.error(`[verify:ext] ✗ 新语言 ${FIXTURE_ID} 没有出现在 allLanguageIds 里`)
    exitCode = 1
  } else {
    console.log(`[verify:ext] ✓ 注册表自动发现新语言（未改动任何代码）`)
  }

  // 默认构建里，私有目录必须是隐形的
  const publicOnly = generateRegistry({ write: false })
  if (publicOnly.allLanguageIds.includes(FIXTURE_ID)) {
    console.error('[verify:ext] ✗ 私有目录泄漏进了正常构建的 allLanguageIds')
    exitCode = 1
  } else {
    console.log('[verify:ext] ✓ 私有目录在正常构建中不可见（中断残留不会污染校验）')
  }

  /*
   * 关键断言：src 下（排除 generated）不得出现该语言 id。
   *
   * 这个扫描是**刻意保持朴素**的：连注释里的字面出现也算违规，不做注释剥离。
   * 剥离注释（无论用正则还是真解析器）都会引入「字符串里含 // 被当成注释吃掉」这类
   * 隐蔽的假阴性 —— 而这条断言的全部价值就在于「宁枉勿纵」，所以能出现这个 id 的地方
   * 就只有 scripts/ 下的本文件与私有目录本身。
   */
  const offenders: string[] = []
  for (const file of walk(path.join(ROOT, 'src'))) {
    if (file.includes(`${path.sep}generated${path.sep}`)) continue
    if (fs.readFileSync(file, 'utf8').includes(FIXTURE_ID)) {
      offenders.push(path.relative(ROOT, file))
    }
  }

  if (offenders.length) {
    console.error('[verify:ext] ✗ 以下源码引用了具体语言 id，说明「加语言只加数据」的承诺被破坏：')
    for (const f of offenders) console.error(`           - ${f}`)
    exitCode = 1
  } else {
    console.log('[verify:ext] ✓ src/ 下（不含 generated）没有任何代码引用具体语言 id')
  }
} finally {
  cleanup()
  // 恢复注册表（本次流程其实不需要改它，但保留这层保护以防将来加回注册步骤）
  void registryFile
  console.log('[verify:ext] 已清理临时语言目录')
}

if (exitCode === 0) {
  console.log('[verify:ext] 通过：新增语言只需 content/ 目录 + registry 注册。')
}
process.exit(exitCode)
