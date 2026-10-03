# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目是什么

多语言并排对比学习工具：**选一门基准语言**（JavaScript / Python / Java 三门，固定不变），勾选若干**对比语言**，沿板块并排看每一门「和基准差在哪」。Vue 3 + Vite + TS，纯静态 SSG，无后端。

**内容按「语言」组织，不是按「方向」组织**：每门语言自带一份内容，内容是「本语言相对于三大基准语言的差异」；清单集中在 `content/catalog/`，与内容分离。加一门语言 = 加一个目录（线性成本），不是加 N 个方向目录（平方成本）。

**章节分类按「基准」各一份**：清单分两层 —— **feature 池**（这个板块有哪些知识点，与基准无关）+ **每基准的章节分组**（该基准怎么把它们讲给读者听）。两层的接缝是 `group`（**存放组**，即内容文件名），于是同一个知识点可以在 JS 视角下落在「对象与原型」章、在 Python 视角下落在「类与继承」章，**而内容只写一份**。

## 文档以这两份为准（硬约束）

| 文档 | 管什么 |
| --- | --- |
| [docs/完整项目架构.md](docs/完整项目架构.md) | **架构的唯一权威描述**：系统现在是什么样、为什么这么设计 |
| [docs/项目步骤规划与进度台账.md](docs/项目步骤规划与进度台账.md) | **实施步骤与进度的唯一权威描述**：走到哪了、下一步做什么、哪些账没结 |

`docs/项目架构设计.md` 已删除（v1 正文早已失效；其 ADR-01 – ADR-35 是决策历史，
2026-10-03 已并入完整项目架构.md 附录 B.1，与 v2 的 ADR-40 起同处一份）。
真正的**理解本仓库最短路径**是 README 的「四条核心设计」+ 上述架构文档。

**执行约定（每次动 `content/` 或 `src/` 的计划性改动都要遵守）**：

1. **动手前**：先读台账 §0 的进度总表，确认当前位置与下一步。
2. **完成后**：把该阶段的执行结果写回两份文档的相应位置 ——
   - 台账：状态改 ✅ + 提交号 + **实际执行记录**（与计划的差、踩到的坑、修过的错）；
     §0.1「当前真身」的数字同步（`npm run content:report` 的输出）。
   - 架构文档：**架构变了**（新字段 / 新规则 / 新判据 / 新板块 / 目录结构变了）才改，
     并在附录 B 追加一条 ADR；只是「把计划实现了」则去掉「计划中」措辞、换成本地实际数字。
3. **不改写历史记录**：修订已完成阶段的计划时，在原计划旁补一段「实际执行」，不覆盖原文。
4. **判断标准只有一条**：一个从没参与过这个项目的人，只读这两份文档，
   能不能说出「系统现在是什么样、为什么这样、下一步做什么、哪些账还没结」。

> **当前状态（2026-10-03）：内容爬坡期，四个板块的正文与速查三兄弟都已铺满。**
> **S0–S7.6、S9、S10 完成** —— 架构切到 v2.1，四个板块的正文与对比列全部落库；
> **速查三兄弟从 6 个方向补到 12 个**（3 基准 × 4 目标），每方向 12 陷阱 / 10 词典 / 5 路线。
> **S11 进行中**：新增 7 门对比列语言，**轮 ①（TypeScript + ArkTS）已完成并启用**。
> 现状：4 个板块 / **22 个存放组 / 104 个知识点 / 12 份章节分组** / **728 个对比框**
> （104 × **7 门启用语言**，**七门各 100%**）+ **速查 12 个方向 / 324 条**（各方向另有 `meta.yaml` 留痕）；
> `content:validate` **error 0 / warn 1**；185 条可索引路由；163 条测试。
> 剩下的**一笔账**（见台账 §0.2）：**S8** 校对升级（728 条 draft → 那 1 条 R6 warn）——
> 注意它**不含速查**：速查不在 728 格里，`meta.yaml` 的 `state` 也不参与发布门槛。
> S11 还剩轮 ②–④（Kotlin/Swift/Dart → C++ → PHP），分批见台账 §6.7。
> 旧内容完整存档在 `content.legacy/`，**不参与构建与校验**，填新内容时可对照旧写法。
> 分批与写作口径见 [docs/项目步骤规划与进度台账.md](docs/项目步骤规划与进度台账.md) 第 6 章。

## 常用命令

```bash
npm run dev              # content:build + vite（改了 content/ 必须重启或重跑 content:build）
npm run content:validate # 只跑校验（CI 阻断闸门，error 级问题非零退出）
npm run content:build    # 校验 + 生成 src/generated/*
npm run content:report   # 覆盖率 / 审阅状态 / 待校对清单
npm run typecheck        # vue-tsc --noEmit
npm test                 # vitest run
npx vitest run tests/unit/catalog-loader.test.ts   # 跑单个测试文件
npm run verify:ext       # 断言"加语言只加数据"，会造临时语言再清理
npm run verify:sections  # 断言"加板块只加数据"，扫描 src/ 里硬编码的板块 id
npm run registry         # 重新生成 registry.gen.ts 与 sections.gen.ts
npm run build            # content:build + vite-ssg build + finalize-dist（含预渲染验收）
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）依次跑 `content:validate → typecheck → test → verify:ext → verify:sections → content:build → build`。末尾那次完整 `npm run build` 是刻意加的：`dirStyle`、预渲染验收、`404.html` 只在 [finalize-dist](scripts/build/finalize-dist.ts) 里暴露。CI 里不设 `PC_SITE_URL`，因此跳过 sitemap。

部署构建需两个环境变量，`PC_BASE_PATH` **不带前导斜杠**：

```bash
PC_SITE_URL=https://<user>.github.io PC_BASE_PATH=code-lang-compare npm run build
```

## 架构要点

### 1. 单向数据流：`content/` 是唯一人工编辑入口

```
content/**/*.yaml ──[validate → build]──▶ src/generated/** ──▶ 运行时视图
```

`src/generated/` 全部是构建产物，**永远不要手改**（含 `catalog.json`、`manifest.json`、`registry.gen.ts`、`sections.gen.ts`、`content/*.json`、`search-index/*.json`）。跨过分界线只能由 `npm run content:build` 单向完成。

### 2. 内容模型：池 / 分组 / 内容 / 方向四段

| 内容 | 路径 | 管什么 |
| --- | --- | --- |
| **feature 池** | `content/catalog/<板块>/features.yaml` | 该板块有哪些知识点，每个属于哪个 `group`（**与基准无关，全站唯一**） |
| **章节分组** | `content/catalog/<板块>/<基准 id>.yaml` | 该基准把池里的知识点分成哪几章、叫什么、什么顺序、取舍哪些 |
| 一对多内容 | `content/languages/<语言>/<板块>/<group>.yaml` | 每门语言在各知识点上的 `boxes`。**第三段是存放组，不是展示章** |
| 方向性内容 | `content/pairs/<基准>2<目标>/`（`meta.yaml` + `{pitfalls,glossary,roadmap}.yaml`） | 速查三兄弟，12 个方向 |

四点约定：

1. **章节 id 由章节分组自己声明**（不再由文件名派生），只在「该基准 × 该板块」内唯一 —— 同名章节在不同基准下**不代表同义**。
2. **pool 与章节分组要显式声明身份**（`section`，分组还要 `baseline`），且必须与目录名、文件名一致（R20c）；语言内容文件则一律由路径派生，不重复声明（`.strict()` 会让重复声明直接报错）。
3. **存放组与基准无关** —— 这是「每基准一份章节分类」不让内容翻倍的全部原因。改章节分组**永远不动内容文件**。
4. **`pairs/` 的目录名必须是完整的语言 id**（`javascript2python`，不是 `js2python`）—— 归属由目录名反查，不允许别名。

### 2.1 对比框：三个槽位，第③槽按角色分两套

一个 feature × 一门语言 = 矩阵里的一格，三个槽位：

| 槽位 | 字段 | 说明 |
| --- | --- | --- |
| ① 代码 | `code`（或 `blocks` 多段） | 这门语言自己的写法，**与读者基准无关** |
| ② 注释 | 代码内联的 `@note` | 不是独立字段，它就在 `code` 里 |
| ③ 说明 | `baseline` / `vs.<基准 id>` | **唯一按角色变化的槽位** |

**这是本架构的枢纽**：同一门语言作**基准列**时读 `baseline`（它自己是什么），作**对比列**时读 `vs.<当前基准>`（它和当前基准差在哪）。视角无法互相推导，所以每门语言要为**每个基准**各写一份 —— 这是本架构的主要成本，也是它准确的原因。

`equivalence` 同样按基准分（`equivalence.<基准 id>`，缺 key = `identical`）。

**双角色取值的唯一落点是 [src/content/boxView.ts](src/content/boxView.ts)**（`explanationOf` / `badgeOf`）。矩阵、并排、特性页三处都调它 —— 各写一遍的话「基准列显示成对比说明」这种错会只在其中一处出现，且不报错。

`badgeOf` 的三条规则**顺序不能换**：基准列 → `null`（自指、零信息量）；`absent` → `'absent'`（**必须短路掉 `equivalence` 的缺省值**，否则灰格会顶着一枚 `=`）；其余取 `equivalence[基准] ?? 'identical'`。

### 2.2 板块与 URL

板块集合（`registry.yaml` 的 `sections:` 段）：

| id | 名称 | shape | scope | columns |
| --- | --- | --- | --- | --- |
| `express` / `model` / `mechanism` / `practice` | 基础表达 / 数据与抽象 / 语言机制 / 工程实践 | chapter | baseline | multi |
| `pitfalls` / `glossary` / `roadmap` | 速查三兄弟 | list | pair | single |

分界依据：按**迁移者先关心什么**重划 —— `express` 能读懂、`model` 能改写、`mechanism` 敢动它、`practice` 能落地。
命名刻意是主题式的而非「第一课 / 第二课」：本站是查阅型地图，四个板块表达的是关注点而非阅读顺序。

```
/compare/<基准>/<板块>/<章节>     列 = 基准 + 页内多选的对比语言；章节由该基准的分组定义
/compare/<基准>/<板块>            章节型落到该基准首个有内容的章；列表型就是它自己
/compare/<基准>                   落到 compareEntryPath
/feature/<板块>/<feature>         全局 id 两段（与基准无关）
```

- **基准进 URL**：每个基准是一套独立的浏览语境，要能预渲染、能分享。
- **对比语言不进 URL**：它是「我现在想看哪几门」，由页内 [CompareLanguageBar](src/components/compare/CompareLanguageBar.vue) 决定。章节型板块是**多选**（`compareLangs`），速查三兄弟是**单选**（`preferredTarget`，跨板块共享）。
- **旧 URL 不保留重定向**，一律 404（静态托管做不了 301，为过渡地址预渲染一堆外壳是纯粹的负担）。
- **对比语言不进 URL 的直接后果**：换勾选不产生导航，路由守卫不会重跑。所以**守卫里要把所有可见列的分片都 `await` 完** —— 只等基准列的话，SSG 同步渲染时其余列还停在「加载中」，预渲染出来就是空壳（`finalize-dist` 有一条专门的探针抓这个）。

### 2.3 加内容的操作路径

**加一个知识点**：在池 `catalog/<板块>/features.yaml` 加一条（含 `group`）→ 在**想展示它的**基准的章节分组里引用它的 id → 给每门语言各加一条同 key 的 box（写进 `languages/<语言>/<板块>/<group>.yaml`）。缺哪一格由 R20g/R24 报（迁移期是 warn）。**只想在某个基准下展示就只改那一份分组** —— 这正是分层的目的。

**加一门语言**：`cp -r content/languages/_template content/languages/<id>` → 填 `meta.yaml` → 按板块填内容（文件名 = 池里的 `group`）→ 在 `registry.yaml` 登记 `enabled: true` → `npm run content:build && npm run verify:ext`。**不需要改任何组件/类型/路由**。[verify-extensibility.ts](scripts/verify-extensibility.ts) 是这条承诺的可执行断言。

**加一个板块**：在 `registry.yaml` 的 `sections:` 段加一条 + 建 `content/catalog/<板块>/{features.yaml,<基准>.yaml}`。`shape: chapter` 的**零代码**（自动复用 `ChapterCompareView`）；`shape: list` 的复用已有渲染器也零代码。[verify-section-extensibility.ts](scripts/verify-section-extensibility.ts) 是这条承诺的可执行断言。

**调章节分类**（本次新增的能力）：只改 `catalog/<板块>/<基准>.yaml` —— 改标题、换顺序、重新分组、取舍知识点都行。**一个内容文件都不用碰**，因为内容的归属是池里的 `group`。

### 3. 契约与校验

- **类型唯一真源**：[src/schemas/index.ts](src/schemas/index.ts)（Zod）。`src/types/index.ts` 只做 `z.infer` 再导出，禁止手写 interface。
- **校验规则 R1–R27** 在 [scripts/lib/analyze.ts](scripts/lib/analyze.ts)：

  | 规则 | 内容 | 级别 |
  | --- | --- | --- |
  | R20a | 章节分组引用的 feature id 必须在池里 | error |
  | R20b | 池内 feature id 唯一 | error |
  | R20c | 文件名/目录名与 `section` / `baseline` 字段一致；章内 id 唯一 | error |
  | R20d | 语言目录里的内容文件，其 `group` 不在池里（拼错或孤儿） | error |
  | R20e | 池里某 feature 不被任何基准的章节分组引用（永不展示） | warn |
  | R20f | 池里声明的 group 没有任何启用语言写它 | warn |
  | R20g | 「某语言 × 某章」一个存放组都没写（整列留白），按 (语言, 板块) 汇总 | warn |
  | R20h | 同一 feature 在同一基准下出现在多个章；章内 feature 重复 | error/warn |
  | R21 | box key 必须属于**池中该存放组**的 feature 集合 | error |
  | R22 | `vs` 完整性：基准候选写除自己外 2 门、非基准写全 3 门 | **error**（S8 翻级） |
  | R23 | 基准候选在**被它引用的** feature 上要有 `baseline` | **error**（S8 翻级） |
  | R24 | 被某基准引用、文件缺 key、且未 `absent` → 疑似漏写 | warn（**刻意不翻**） |
  | R25 | `vs.<基准>` / `baseline` 点名屏幕外的语言（幽灵语言）。**同族语言除外**（ADR-71：`registry.yaml` 的 `mentionGroups`，当前只有 JS ↔ TS） | warn |
  | R26 | `absent: true` 且给了 `code`（惯用替代写法）→ 必须有说明 | warn |
  | R27 | 某章引用了 group G 但该基准缺 G 的内容（基准列空洞），按 (基准, 板块) 汇总 | warn |

  另有沿用 v1 的 R3（provenance）/ R4·R9（`@note`）/ R5（引用完整性）/ R6（发布门槛）/ R7（https）/ R8（注册表自检）/ R10（台账）/ R17（校对记录）。

- **R22 / R23 是 error，R24 刻意保持 warn**（S8 定的级）。三者都是「内容补齐期」的过渡产物，账目归零后**只翻了 R22 / R23** —— 它们是硬契约（`vs` 缺一份读者永远看不到、基准列空着就是坏页），不存在「合法地留空」。**R24 不翻**：它判的是「键缺失且没标 `absent`」，而**空框本身合法**，翻成 error 会逼作者在「还没写」与「本来就没有」之间二选一 —— 那正是这个字段要区分的两件事。它是一条提醒人确认的规则，不是能自动判定对错的规则。
- **三者的求值域是「该基准真正引用了的知识点」** —— 被某个基准刻意取舍掉的 feature 不该被要求写 `vs` / `baseline`。R22/R24/R20g/R27 都按 `(语言|基准, 板块)` **汇总成一条**输出（逐条会刷屏）；逐条待办在 `npm run content:report`。**注意 R22 的求值域含已启用但还没写内容的语言**：新启一门语言会立刻红，这是刻意要的（宁可写 `enabled: false`，也不要上一列空白）。
- **validate 与 build 共用同一份 `analyzeContent()`**。改校验逻辑只需改这一处，但脚本被改坏时测试未必发现 —— `tests/pipeline/content-contract.test.ts` 与 `tests/unit/section-model.test.ts` 对**真实 content 与真实产物**断言不变量，是第二道闸门。
- **R16 在 schema 层**（`refineBox`）：`code` 与 `blocks` **至多一个**。**「至少一个」被刻意删掉了** —— `absent: true` 的格子天然可以没有代码（「本语言没有变量提升」），强制至少一个会让最典型的 absent 形态解析失败；它的职责由 R24/R26 承担。

### 4. 内容里的约定

**「还没写」与「本语言没有这个概念」必须分开**：后者写 `absent: true`（灰格 +「本语言无此概念」+ ∅ 徽章），前者是键缺失（更淡的留白）。少了这个区分，读者会把「语言之间没有这个差异」误读成「这里内容缺失」。

**`@note` 内联标记**：差异说明写在代码注释里，不用行号锚定（行号会随编辑静默漂移）。标记必须出现在该语言自己的行注释前缀（`meta.comment.line`）之后：`x = 1  # @note 赋值即声明`。构建期 [extractNotes](scripts/lib/core.ts) 抽取时**只剥掉标记本身**，`@note` 与 `@note!` 的说明**都留在代码行内**；`@note!` 的差别只是说明前多一个 `⚠`（随 `code` 一起被复制）。搜索索引收的是 `allNotes`（全部注记），别只取 `notes`（仅高危）。

### 5. 构建期做重活，运行时只消费产物

- **Shiki 构建期预高亮**，用 `css-variables` 主题（单份 HTML，明暗靠 CSS 变量切换）。Shiki / markdown-it / zod / js-yaml 都是 devDependency，**不进客户端包**。
- **Markdown 走 markdown-it 且 `html: false`**（禁裸 HTML）—— 内容是 LLM 产出的，这是一条真实的注入路径。
- **diff 刻意留在运行时**（[src/content/diff.ts](src/content/diff.ts)）：基准可切、对比列可多选、展示模式会变，预计算是几十种组合的浪费。用 `diffArrays` 逐行对齐，**不要换回 `diffLines`**（它会把相邻删除+新增合并成块，让完全相同的行也被标成「不同」，有回归测试）。
- **内容分片 = 一门语言 × 一个存放组**（`src/generated/content/<语言>/<板块>/<存放组>.json`），由 [repository.ts](src/content/repository.ts) 用 `import.meta.glob` 懒加载。**分片键两侧必须逐字一致**（构建期 emit 路径 ↔ `boxShardPathOf`），错一个字符就是**整页空白且不报错**。
- **一章 = 若干存放组的组合**：章节页按 `groupsOfChapter(基准, 板块, 章节)` 收集分片，再把它们**合并成一门语言一份的扁平格子表**（`Record<语言, Record<featureId, RenderedBox>>`）交给布局。**合并结果必须保留外层语言键** —— 布局用 `!boxes[lang.id]` 区分「加载中」与「这门语言没写」，丢了它未加载的格子会永远转圈，`finalize-dist` 的空壳探针会红。`groupsOfChapter` 在构建期（[04-build.ts](scripts/pipeline/04-build.ts)，决定路由）与运行时（[repository.ts](src/content/repository.ts)，决定加载）**必须同判据**。
- **清单独立成 `catalog.json`**（小、eager import）：`catalogs` 是**每基准一份**的章节分组（features 已在构建期 join 上池字段），`featureIndex` 是**与基准无关**的 `<板块>/<feature>` 索引。
- **`features` / `featureIndex` 必须从池构建**，不能遍历章节分组 —— 同一批知识点会被每个基准各引用一次，遍历等于数三遍。`tests/pipeline/content-contract.test.ts` 有一条专门的探针断言这件事。
- **速查按对拆文件**（`static/<基准>--<目标>.json`），同样懒加载。

### 6. SEO 与预渲染

`manifest.routes` 是**可索引路由的单点定义**，vite-ssg 预渲染与 `sitemap.xml` 共用它。[scripts/pipeline/04-build.ts](scripts/pipeline/04-build.ts) 生成 —— 别被 `npm run registry` 的名字骗了，[generate-registry.ts](scripts/build/generate-registry.ts) 只产出 `registry.gen.ts`（LanguageId 类型），不碰 routes / pairs。

`prerenderExtra`（预渲染但**不进 sitemap**）现在只有 `/search` 一项。

`vite.config.ts` 的 `ssgOptions.dirStyle` **必须是 `nested`**（默认 `flat` 产出 `.html`，GitHub Pages 不做无扩展名解析 → 只有首页能打开）。构建最后一步 [finalize-dist.ts](scripts/build/finalize-dist.ts) 做两件验收：① 每条路由的 HTML 含该页真实内容；② **不含「加载中…」**（「页面结构在、内容没渲染出来」这类空壳的探针）。**探针的正则必须跟着路由形状改** —— feature 路由从 2 段变 3 段时漏改一处，验收就静默失效（正则不匹配 → 返回 null → 跳过检查）。

SEO 文案里出现的**目标语言是按运行时同一套规则算出来的默认方向**（速查板块），构建期与运行时必须同判据。

### 7. 搜索：中文分词 + 按语言分片

**分词**：MiniSearch 基于空格分词，中文会**静默失效**。`Intl.Segmenter` 实测不可靠（`'数组与列表'` → 丢掉「数组」），因此走 **bigram**（unigram + 相邻二元组），查询侧 `combineWith: 'AND'`。[search-tokenize.ts](src/content/search-tokenize.ts) **构建期与客户端共用同一份** —— 两边分叉会导致同一个静默失败。

**分片**：索引按**语言**分片（`src/generated/search-index/<语言>.json`），客户端加载**当前可见的那几门**，于是「搜到的」与「屏幕上能看到的列」天然一致，查询侧不需要再过滤。速查三兄弟归入**目标语言**的分片。索引收的是注记 + 说明文本，**不含代码原文**。

## 测试地图

`npm test` = `vitest run`。7 个文件按"钉住什么"分两类（S9 删掉运行时 diff 引擎时，
`diff.test.ts` 与 `blocks.test.ts` 一并删除）：

| 文件 | 钉住的不变量 |
| --- | --- |
| [tests/pipeline/content-contract.test.ts](tests/pipeline/content-contract.test.ts) | **对真实 `content/` 跑 `analyzeContent()`**：0 error、全局 id 两段唯一、**`featureIndex` 来自池而非遍历章节分组**、R21、provenance（llm 无 license）、台账、@note 无残留、`vs` 的 key 必须是基准候选；**速查正文的写作口径**两条（只讲本方向两门语言、提到的板块名必须真实存在 —— R5 够不到散文那一层） |
| [tests/unit/section-model.test.ts](tests/unit/section-model.test.ts) | **对真实 `src/generated/` 产物**断言：分片路径与声明的 (语言,板块,存放组) 一致、catalog.json 的 key 是两段、章节 features 已 join 且带 `group`、**章节分类确实随基准变**、**章节可见性与路由同源**（没内容的章不产出路由，反之亦然 —— 骨架期这条天天在跑）、**双角色取值**（基准列 null 徽章 / absent 短路 / vs 缺 key 才是 identical） |
| [tests/unit/pool-loader.test.ts](tests/unit/pool-loader.test.ts) | 装载器：池与章节分组、**同一 feature 在不同基准下落到不同章**、池驱动的语言内容、`_` 私有目录跳过、`pairs/` 方向反查、**速查 `meta.yaml` 的留痕**（缺失合法、存在则被解析而非静默丢弃）、**对比框契约**（code/blocks 至多一个、absent 可三槽全空、`.strict()` 拒绝重复声明） |
| [tests/unit/baseline-switch.test.ts](tests/unit/baseline-switch.test.ts) | 基准候选与默认值、**候选与列的显示顺序**、可见列计算、目标语言推导、切基准回落、**速查方向的顺序与默认回落按书写序**（ADR-67） |
| [tests/unit/search.test.ts](tests/unit/search.test.ts) | 中文 bigram 分词、按语言分片、查询无需过滤、pair 归目标语言 |
| [tests/unit/extract-notes.test.ts](tests/unit/extract-notes.test.ts) | `extractNotes` 的 `notes`（仅高危）/ `allNotes`（全部）分流契约 |
| [tests/unit/lang-mention.test.ts](tests/unit/lang-mention.test.ts) | R25 的语言点名检测器（`JavaScript` 含 `Java`、`Go` 撞英文动词） |

前两个**读真实内容目录与真实构建产物**，因此它们既是回归测试、也是内容契约的第二道闸门。

## 编辑内容时的硬约束

- 新增内容默认 `review.state: draft`；`registry.publishPolicy` 为 `include-draft-with-badge`（当前值）时 draft 可构建但页面必须显示"未经人工校对"；切到 `reviewed-only` 时 draft 直接**阻断构建**（R6）。
- `provenance.origin: 'llm'` **刻意不填 `license`** —— 模型输出不产生可署名许可，强填 MIT/GFDL 是错误陈述。
- 以 `_` 开头的语言目录是**私有目录**，默认不参与构建与校验（`_template/`、`verify:ext` 的 `_fixturelang`）。新增真语言不要用下划线前缀。
- **YAML 普通标量不能以反引号开头**（``title: `x` 是什么`` 会让整章解析失败），也不能写裸 `null`。SEO 模板一律用引号包起来（以 `{` 开头的普通标量会被 YAML 当成流式映射）。
- **速查三兄弟只能讲本方向的两门语言**（R5，**两条**）：`glossary.perLanguage` 的键与 `pitfalls.languages` 的值都必须是 error 级合规；但 `symptom` / `cause` / `fix` / `note` / `todo` 这些**散文** R5 够不到 —— 那一层由 `content-contract.test.ts` 的常设断言守（另有「提到的板块名必须真实存在」，它抓的是从 v1 搬过来的「心智模型」/「基础语法」这类死引用）。
- **`baseline` 文本只讲本语言、`vs.<基准>` 只讲那两门**（R25，warn）：多列板块里提第三门就是屏幕外的幽灵语言。**例外是 JavaScript ↔ TypeScript**（ADR-71）—— 它们在 `registry.yaml` 的 `mentionGroups` 里同组，互相点名不算幽灵（判据按本语言与该格基准**两门**算）；ArkTS 刻意不在这一组里。
- 所有外部 URL 必须是 `https`（R7）。
- **compare 路由里只有基准 / 板块 / 章节三段**，章节由**该基准的**章节分组定义；feature id 是 `<板块>/<feature>` 两段（不含章节 —— 章节随基准变）。组件里不要拼这些字符串，也不要写死板块名；`verify:sections` 会拦住硬编码的板块 id（白名单在脚本里，每条都写了理由）。
- **面向用户的文案里不许写死语言名**：三门基准**权重相同**。语言名一律从 meta 取，i18n 里走 `{baseline}` 这类占位符。`verify:ext` 的**第三道断言**守着这条：扫描 i18n 的**值**与 `.vue` 的 `<template>` 段（先摘掉 `<script>` 和 HTML 注释）。
- **新增 `src/` 代码时注意两个 verify 脚本的字面量检查**：`verify:ext` 的第二道断言**不剥注释**地找**带引号**的语言 id，`verify:sections` 找带引号的板块 id（会剥注释）。新代码的注释与 message 用 `<section>/<chapter>/<feature>` 这类占位式措辞即可同时过关。

## 环境陷阱

- **`PC_BASE_PATH` 不带前导斜杠**：Git Bash / MSYS 会把以 `/` 开头的环境变量改写成 Windows 绝对路径。解析逻辑与提示在 [scripts/lib/env-paths.ts](scripts/lib/env-paths.ts)。
- **`public/sitemap.xml` 与 `public/robots.txt` 是构建产物，已 `.gitignore`**：`robots.txt` 是**无条件重写**，所以跑构建时总会重新生成。`public/` 下只保留手工维护的 `favicon.svg`。
- **仓库没有配置 remote**（ci.yml / deploy.yml 监听 `main`）。加 remote 并 push 之前，CI 与部署都不会跑。
- **esbuild / rollup 原生二进制丢失**：npm 已知 bug（[#4828](https://github.com/npm/cli/issues/4828)）会静默跳过平台专用可选依赖，报错信息与真实原因完全无关。仍复发则 `rm -rf node_modules package-lock.json && npm install`。
- **`git mv` 一个目录时若有进程占着它（例如正在跑的 `npm run dev` 的 Vite 文件监视器），会报 `Permission denied`** —— 而且脚本若无 `set -e` 会继续往下跑，把后续步骤做成一团乱。动 `content/` 之前先停掉 dev server。
- `dist/`、`node_modules/` 见 `.gitignore`；`content.legacy/` **要入库**（是刻意保留的对照材料）。

## 已知遗留

- **`rust` / `go` / `typescript` / `arkts`（以及后续轮次新增的语言）都是「对比列语言」**（`meta.yaml` 里 `baseline: false`）：**只写 `vs.{javascript,python,java}` 三份、不写 `baseline`** —— 它们永远不会被渲染成基准列。这条契约由 `tests/unit/pool-loader.test.ts` 的「非基准语言没有 baseline、三份 vs 写全」守着。**可见性判据是「基准自己写了内容」，不是「有没有章节分组」**。
- **骨架期的池与分组可以自由增删改**：改池或改分组**不动任何内容文件**，这正是骨架先行的意义。这一点已有实证：`express` 池在 S7.1 从 26 个知识点 / 6 个存放组改成 27 / 7，**没有碰任何内容文件**。改动前跑一次 `npm run content:report` 看全貌。
- **速查的 `featureId` 是软引用**：指向 `featureIndex` 里的全局 id，指向不存在的 id 时只断掉「陷阱 → 特性」这条反查链，不影响陷阱渲染（R5 汇总成一条 warn）。**6 个方向共 72 条已于 S7.6 全部重指**。
- **`npm run content:report` 的逐存放组账本**是爬坡期的进度表：`have/N` 是写没写，「vs 全」是三方视角写全没有，末尾 `✔` 表示三个基准都写满（这一批可以划掉）。
- **v1 的 schema 已在 S8 清理干净**（`featureSchema` / `chapterSchema` / `topicConfigSchema` / `snippet*` / `RenderedSnippet` 等，约 400 行），`registrySchema.topics` 与 `registry.yaml` 的 `topics: {}` 占位也一并删除。唯一留下的 v1 词汇是 `featureKindSchema` 里的 `'exercise'` 取值（留着免得未来加回练习类 feature 时动 schema）。
- **`docs/内容书写标准.md` 已按 v2 改写**（池 / 分组 / 存放组、`baseline` 与 `vs.<基准>`、R20–R27），但只到「操作路径准确」这一层，措辞与配图的润色留 S8。
- **搜索索引预算**：`SEARCH_INDEX_BUDGET_KB = 280` 是承认现状的上调，不是取消红线。分片已改按**语言**（`search-index/<语言>.json`），实测 js 99 / java 126 / python 126 / go 19 / rust 20 KB(gz)，**当前全部在预算内**；内容继续补齐后会再涨，破线时的降级路径见架构文档 §13 Q8。
