/**
 * 一次性搬运：多列板块的共享说明 → 基准语言覆盖层的**列内**说明。
 *
 * 背景：`feature.body` 渲染在整块上方、横跨所有列。在列数随用户勾选变化的板块
 * （`columns: multi`：基础语法 / 心智模型）里它盖不住各语言自己的事实，也放不下
 * 各自的差异，而且在矩阵模式下**根本没有渲染点**。正文改为写在每列代码下方
 * （`snippet.body`）：基准列写本语言的客观事实，对比列写与基准的差别。
 *
 * 这里只搬**基准列**那 294 条 —— 内容是现成的，搬运是纯机械操作。
 * 对比列的 762 格要新写，不在本脚本范围内。
 *
 * ## 为什么是行级文本手术，而不是 js-yaml.dump
 *
 * `content/` 下的 YAML 是**手写的、带大量注释**。读进来再 dump 回去会摧毁全部
 * 注释、重排键序、改写块标量（`code: |` 里是代码原文，被加上引号就不再是代码）。
 * 所以这里只做行的增删，其余字节原样保留；写盘前再用 js-yaml **只读**解析改造后
 * 的文本，逐键比对确认没伤到别的字段。
 *
 * ## 幂等（先插后删）
 *
 * 任何时刻中断都不会丢正文 —— 最坏是两侧都有，重跑即可收敛：
 *
 *   topic 有 / snippet 无 → 插入 + 删除
 *   topic 无 / snippet 有 → 已完成，跳过
 *   topic 有 / snippet 有 → 内容逐字相同则只删 topic 侧；
 *                          不同则**覆盖**（concepts 的 78 条基准列本来就有
 *                          一份 25 字的短摘要，按「先全部搬」的决策覆盖，
 *                          被覆盖的原文会列进报告，也可从 git 历史取回）
 *   topic 无 / snippet 无 → 跳过（本来就没有可搬的）
 *
 * 用法：
 *   npx tsx scripts/migrate/feature-body-to-baseline-snippet.ts --dry-run
 *   npx tsx scripts/migrate/feature-body-to-baseline-snippet.ts
 *   npx tsx scripts/migrate/feature-body-to-baseline-snippet.ts --verify
 */
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import yaml from 'js-yaml'
import { LANGUAGES_DIR, TOPICS_DIR, listFiles, loadRegistry } from '../lib/core'

/* ────────────────────────── 行级定位 ────────────────────────── */

/** topic 侧：一个 feature 条目的起点 */
const FEATURE_ID_RE = /^ {2}- id: (\S+)\s*$/
/** topic 侧：共享说明的块标量头 */
const FEATURE_BODY_RE = /^ {4}body: \|\s*$/
/** 覆盖层侧：一个 snippet 条目的起点 */
const SNIPPET_ID_RE = /^ {2}- featureId: (\S+)\s*$/
/** 覆盖层侧：列内说明的块标量头 */
const SNIPPET_BODY_RE = /^ {4}body: \|\s*$/

interface Block {
  /** `body: |` 所在行下标 */
  headerIdx: number
  /** 块内容最后一行（含）；块为空时等于 headerIdx */
  lastIdx: number
  /** 剥掉块公共缩进后的正文行（不含尾随空行） */
  body: string[]
}

/**
 * 读一个块标量。
 *
 * 结束判据是「第一个非空且缩进 ≤ 4 的行」—— YAML 规定块内容必须比它的键缩进更深，
 * 键在缩进 4，所以内容恒 ≥ 5。中间的空行先跳过：它们可能是块内空行，也可能是
 * 条目之间的分隔行，靠后面的非空行才能分辨（`lastIdx` 只记非空行，尾随空行自然被排除）。
 */
function readBlock(lines: string[], headerIdx: number): Block {
  let lastIdx = headerIdx
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    if (/^ {0,4}\S/.test(line)) break
    lastIdx = i
  }
  const raw = lines.slice(headerIdx + 1, lastIdx + 1)
  /* 块缩进由**首个非空行**决定（YAML 语义）—— 后面的行只会更深，不会更浅 */
  const first = raw.find((l) => l.trim() !== '')
  const indent = first ? first.match(/^ */)![0].length : 0
  return {
    headerIdx,
    lastIdx,
    body: raw.map((l) => (l.trim() === '' ? '' : l.slice(indent))),
  }
}

/** 把正文行渲染成一个 `body: |` 块（缩进 4 的键 + 缩进 6 的内容） */
function emitBlock(body: string[]): string[] {
  return ['    body: |', ...body.map((l) => (l === '' ? '' : `      ${l}`))]
}

/**
 * 一个 snippet 条目的最后一行（含）。
 *
 * 覆盖层的键序并不统一（有的逐条写 `review:`，有的用文件级默认），所以不能用
 * 「插在 `review:` 之前」这种依赖具体键的定位 —— 一律插到条目末尾。
 */
function snippetEntryEnd(lines: string[], startIdx: number): number {
  let end = startIdx
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (SNIPPET_ID_RE.test(line)) break
    if (line.trim() === '') continue
    if (/^\S/.test(line)) break // 文件级键（topic: / review: / snippets:）
    end = i
  }
  return end
}

/* ────────────────────────── 文件读写 ────────────────────────── */

/** 行尾运行时探测：仓库里是 LF，但 core.autocrlf 会让 checkout 出 CRLF，不能写死 */
function splitEol(raw: string): { lines: string[]; eol: string } {
  return {
    lines: raw.split(/\r?\n/),
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
  }
}

function writeLines(file: string, lines: string[], eol: string): void {
  fs.writeFileSync(file, lines.join(eol), 'utf8')
}

/* ────────────────────────── 主流程 ────────────────────────── */

interface Job {
  topicId: string
  baseline: string
  file: string
  topicFile: string
  overlayFile: string
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const VERIFY = args.has('--verify')

const registry = loadRegistry()

/*
 * 目标由**注册表派生**而不是写死 6 个 id：判据（`columns === 'multi'`）与
 * analyze.ts 的 R18/R19 同源，将来再加多列板块时这个脚本不会静默漏掉它。
 */
const multiTopics = Object.entries(registry.topics)
  .filter(([, cfg]) => cfg.enabled && registry.sections[cfg.section]?.columns === 'multi')
  .map(([id, cfg]) => ({ id, baseline: cfg.baseline }))

if (VERIFY) {
  verify()
} else {
  migrate()
}

/* ────────────────────────── 实现 ────────────────────────── */

function collectJobs(): Job[] {
  const jobs: Job[] = []
  for (const { id: topicId, baseline } of multiTopics) {
    const topicDir = path.join(TOPICS_DIR, topicId)
    const overlayDir = path.join(LANGUAGES_DIR, baseline, 'snippets', topicId)
    if (!fs.existsSync(overlayDir)) {
      abort(`基准语言 '${baseline}' 没有 '${topicId}' 的覆盖层目录：${overlayDir}`)
    }
    const topicFiles = listFiles(topicDir)
    const overlayFiles = listFiles(overlayDir)
    /* 前置断言①：两侧章节文件名逐字相等 —— 少一个就会把正文搬进错的文件 */
    const names = (fs: string[]) => fs.map((f) => path.basename(f)).join('|')
    if (names(topicFiles) !== names(overlayFiles)) {
      abort(
        `'${topicId}' 两侧章节文件不一致：\n  topic   ${names(topicFiles)}\n  overlay ${names(overlayFiles)}`,
      )
    }
    for (const topicFile of topicFiles) {
      const file = path.basename(topicFile)
      jobs.push({
        topicId,
        baseline,
        file,
        topicFile,
        overlayFile: path.join(overlayDir, file),
      })
    }
  }
  return jobs
}

function migrate(): void {
  const jobs = collectJobs()
  let moved = 0
  let skipped = 0
  let overwritten = 0
  let untouched = 0
  const overwrittenList: string[] = []
  let touchedFiles = 0

  for (const job of jobs) {
    const topicRaw = fs.readFileSync(job.topicFile, 'utf8')
    const overlayRaw = fs.readFileSync(job.overlayFile, 'utf8')
    const topic = splitEol(topicRaw)
    const overlay = splitEol(overlayRaw)
    /* 手术前的解析结果，写盘前用来逐键比对（见 assertSurgery） */
    const topicBefore = yaml.load(topicRaw) as {
      features: Array<{ id: string; body?: string }>
    }
    const overlayBefore = yaml.load(overlayRaw) as {
      snippets: Array<{ featureId: string; body?: string }>
    }

    /* 前置断言②：两侧的 feature 有序列表必须一一对应 */
    const topicIds = topic.lines.map((l) => FEATURE_ID_RE.exec(l)?.[1]).filter(Boolean) as string[]
    const overlayIds = overlay.lines
      .map((l) => SNIPPET_ID_RE.exec(l)?.[1])
      .filter(Boolean) as string[]
    if (topicIds.join('|') !== overlayIds.join('|')) {
      abort(
        `${job.topicId}/${job.file} 两侧 feature 列表不一致：\n` +
          `  topic   ${topicIds.join(', ')}\n  overlay ${overlayIds.join(', ')}`,
      )
    }

    /* 边界情况：多列板块不该有 exercise（题面机制只存在于 migration） */
    for (const line of topic.lines) {
      if (/^    kind: exercise\s*$/.test(line)) {
        abort(`${job.topicId}/${job.file} 出现了 kind: exercise —— 多列板块不应有练习条目`)
      }
    }

    let topicChanged = false
    /* 从后往前处理：插入/删除都不影响前面尚未处理的下标 */
    for (let i = topic.lines.length - 1; i >= 0; i--) {
      if (!FEATURE_BODY_RE.test(topic.lines[i]!)) continue

      let featureId: string | undefined
      for (let j = i; j >= 0; j--) {
        const m = FEATURE_ID_RE.exec(topic.lines[j]!)
        if (m) {
          featureId = m[1]
          break
        }
      }
      if (!featureId) abort(`${job.topicFile}:${i + 1} 的 body 找不到所属 feature`)

      const src = readBlock(topic.lines, i)
      const text = src.body.join('\n')

      const snippetIdx = overlay.lines.findIndex((l) => SNIPPET_ID_RE.exec(l)?.[1] === featureId)
      if (snippetIdx < 0) abort(`${job.overlayFile} 缺少 '${featureId}' 的实现`)

      const existingIdx = (() => {
        const end = snippetEntryEnd(overlay.lines, snippetIdx)
        for (let k = snippetIdx + 1; k <= end; k++) {
          if (SNIPPET_BODY_RE.test(overlay.lines[k]!)) return k
        }
        return -1
      })()

      if (existingIdx >= 0) {
        const dst = readBlock(overlay.lines, existingIdx)
        const dstText = dst.body.join('\n')
        if (dstText.trim() === text.trim()) {
          /* 两侧相同 = 插入已完成、只差删除。删掉 topic 侧即可收敛 */
          topic.lines.splice(src.headerIdx, src.lastIdx - src.headerIdx + 1)
          topicChanged = true
          skipped++
          continue
        }
        /* 内容不同：按「先全部搬」覆盖，原文进报告 */
        overwrittenList.push(`  · ${featureId}\n      被覆盖：${dstText.trim().replace(/\s+/g, ' ')}`)
        overlay.lines.splice(dst.headerIdx, dst.lastIdx - dst.headerIdx + 1)
        overwritten++
      }

      const end = snippetEntryEnd(overlay.lines, snippetIdx)
      overlay.lines.splice(end + 1, 0, ...emitBlock(src.body))
      topic.lines.splice(src.headerIdx, src.lastIdx - src.headerIdx + 1)
      topicChanged = true
      moved++
    }

    if (topicChanged) {
      assertSurgery(job, topic.lines, overlay.lines, topicBefore, overlayBefore)
      if (!DRY_RUN) {
        /* 先写覆盖层再写 topic：反过来的话中断会丢正文 */
        writeLines(job.overlayFile, overlay.lines, overlay.eol)
        writeLines(job.topicFile, topic.lines, topic.eol)
      }
      touchedFiles++
    } else {
      untouched++
    }
  }

  const flag = DRY_RUN ? '（--dry-run，未写盘）' : ''
  console.log(`[migrate] 搬运 ${moved} 条 / 跳过 ${skipped} 条 / 覆盖既有 ${overwritten} 条`)
  console.log(`[migrate] 触及 ${touchedFiles} 个文件，未改动 ${untouched} 个${flag}`)
  if (overwrittenList.length) {
    console.log(`\n[migrate] 被覆盖的既有说明（原文可从 git 历史取回）：`)
    console.log(overwrittenList.join('\n'))
  }
}

/**
 * 写盘前的安全网：把手术结果与**期望值**逐键比对。
 *
 * 期望值是这么构造的 —— 拿手术前的解析结果，只把「被搬走的 body」按新位置
 * 填好：topic 侧删掉、覆盖层侧设成**解析后的** feature.body。于是这条断言
 * 覆盖了三件事：
 *   ① 手术后的文本仍是合法 YAML（解析失败会在这里抛）
 *   ② 除了目标 body，其余字段一个都没被改坏（注释以外的任何结构变化都会不等）
 *   ③ 正文逐字无损 —— 比的是 YAML 解析值而不是我的剥缩进结果，
 *      所以块缩进算错、尾随空行处理错都会立刻显形
 *
 * 比「能解析」强得多：缩进写错 2 格，YAML 照样解析得出来，只是内容变了。
 */
function assertSurgery(
  job: Job,
  topicLines: string[],
  overlayLines: string[],
  topicBefore: { features: Array<{ id: string; body?: string }> },
  overlayBefore: { snippets: Array<{ featureId: string; body?: string }> },
): void {
  let topicAfter: unknown
  let overlayAfter: unknown
  try {
    topicAfter = yaml.load(topicLines.join('\n'))
    overlayAfter = yaml.load(overlayLines.join('\n'))
  } catch (e) {
    abort(`${job.file} 手术结果无法解析为 YAML：${(e as Error).message}`)
  }

  const expectedTopic = structuredClone(topicBefore)
  const expectedOverlay = structuredClone(overlayBefore)
  for (const f of expectedTopic.features) {
    /* 没有 body 的 feature 不动 —— 否则会把覆盖层里已有的说明误删 */
    if (f.body === undefined) continue
    const s = expectedOverlay.snippets.find((x) => x.featureId === f.id)
    if (s) s.body = f.body
    delete f.body
  }

  if (!isDeepStrictEqual(topicAfter, expectedTopic)) {
    abort(
      `${job.topicFile} 的改动超出了预期 —— 除 feature.body 外还有字段被动了。\n` +
        `  请用 git checkout -- content/ 回滚后排查。`,
    )
  }
  if (!isDeepStrictEqual(overlayAfter, expectedOverlay)) {
    abort(
      `${job.overlayFile} 的改动超出了预期 —— 除 snippet.body 外还有字段被动了，` +
        `或正文没有逐字搬过去。\n  请用 git checkout -- content/ 回滚后排查。`,
    )
  }
}

/** 事后核对：多列板块不再有 feature.body，基准列每格都有 body */
function verify(): void {
  const jobs = collectJobs()
  let features = 0
  const problems: string[] = []

  for (const job of jobs) {
    const topic = yaml.load(fs.readFileSync(job.topicFile, 'utf8')) as {
      features: Array<{ id: string; body?: string }>
    }
    const overlay = yaml.load(fs.readFileSync(job.overlayFile, 'utf8')) as {
      snippets: Array<{ featureId: string; body?: string }>
    }
    const bodyById = new Map(overlay.snippets.map((s) => [s.featureId, s.body]))
    for (const f of topic.features) {
      features++
      if (f.body?.trim()) problems.push(`${f.id}：topic 侧仍带着 feature.body`)
      if (!bodyById.get(f.id)?.trim()) problems.push(`${f.id}：基准列没有 body`)
    }
  }

  console.log(`[verify] 检查 ${features} 条 feature（多列板块）`)
  if (problems.length) {
    console.error(`[verify] ${problems.length} 处不满足：`)
    console.error(problems.slice(0, 20).map((p) => `  · ${p}`).join('\n'))
    process.exit(1)
  }
  console.log('[verify] 通过：多列板块已无 feature.body，基准列每格都有 body。')
}

function abort(message: string): never {
  console.error(`[migrate] 中止：${message}`)
  process.exit(1)
}
