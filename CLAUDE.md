# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目是什么

多语言并排对比学习工具：**选一门基准语言**（默认 JS，也可选 Python / Java），沿五个板块——基础语法 / 迁移教程 / 迁移陷阱 / 速语词典 / 迁移学习路线——并排对照目标语言。板块本身也是**可注册的数据**（`content/registry.yaml` 的 `sections` 段），加板块不需要改散落的代码。当前启用 JS、Python、Java、Rust、Go 五门。Vue 3 + Vite + TS，纯静态 SSG，无后端。

基准不是"一个可以随手切的视角"，而是**内容维度**：每个基准有各自的一套内容与地址（`/compare/<基准>/...`），都能预渲染、能分享。

架构文档在 [docs/项目架构设计.md](docs/项目架构设计.md)（讲「现在是什么样、为什么这么设计」，附录 A 是精简决策表）；加内容看 [docs/内容书写标准.md](docs/内容书写标准.md)（讲「怎么做」，每节标注守护它的校验规则）。README 里的"四条核心设计"是理解本仓库的最短路径。

## 常用命令

```bash
npm run dev              # content:build + vite（改了 content/ 必须重启或重跑 content:build）
npm run content:validate # 只跑校验（CI 阻断闸门，error 级问题非零退出）
npm run content:build    # 校验 + 生成 src/generated/*
npm run content:report   # 覆盖率 / 审阅状态 / 待校对清单
npm run typecheck        # vue-tsc --noEmit
npm test                 # vitest run
npx vitest run tests/unit/diff.test.ts        # 跑单个测试文件
npx vitest run -t "覆盖率"                     # 按用例名过滤
npm run verify:ext       # 断言"加语言只加数据"，会造临时语言再清理
npm run verify:sections  # 断言"加板块只加数据"，扫描 src/ 里硬编码的板块 id
npm run build            # content:build + vite-ssg build + finalize-dist（含预渲染验收）
npm run registry         # 重新生成 registry.gen.ts 与 sections.gen.ts
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）依次跑 `content:validate → typecheck → test → verify:ext → verify:sections → content:build`，这就是"能不能进主干"的判据。注意**它不跑 `npm run build`** —— `dirStyle`、预渲染验收、`404.html` 这些只在 `finalize-dist` 里暴露的问题，本地不完整跑一次 `npm run build` 是发现不了的（线上那条链在 [deploy.yml](.github/workflows/deploy.yml)）。

部署构建需两个环境变量，`PC_BASE_PATH` **不带前导斜杠**：

```bash
PC_SITE_URL=https://<user>.github.io PC_BASE_PATH=code-lang-compare npm run build
```

## 架构要点

### 1. 单向数据流：`content/` 是唯一人工编辑入口

```
content/**/*.{yaml,md} ──[03-validate → 04-build]──▶ src/generated/** ──▶ 运行时视图
```

`src/generated/` 全部是构建产物，**永远不要手改**（含 `registry.gen.ts`、`manifest.json`、`content/*.json`、`search-index.json`）。跨过分界线只能由 `npm run content:build` 单向完成。内容改动后若没重跑构建，页面看到的还是旧内容。

### 2. 三轴内容模型：topic 的 `section` / `baseline` / `target`

- `content/topics/<topicId>/NN-*.yaml` —— `Chapter`（含内联 `features`）；topic 目录名即 id
- `content/languages/<id>/snippets/<topicId>/<NN>-<chapter>.yaml` —— 语言覆盖层。**顶层是对象**（`topic` + 可选文件级 `review` + `snippets[]`），不是裸数组；一个 topic 一个子目录，序号在 topic 内递增

**三轴写在 registry.topics 上**（`content/registry.yaml`），形式是 [topicConfigSchema](src/schemas/index.ts)：

| 字段 | 含义 |
| --- | --- |
| `section` | 板块 id，必须是 `registry.sections` 里已注册的（`sectionSchema` 只保证它是非空字符串，成员资格由 `registrySchema.superRefine` 交叉校验——**刻意不用 `z.enum(SECTION_IDS)`**，那会让 `content:validate` 拿上一版生成物校验新内容） |
| `baseline` | 基准语言（from）。所有板块必填 |
| `target` | 目标语言（to）。**`scope: pair` 的板块必填、`scope: baseline` 的必须缺省**，后者由运行时多选决定列。注意：`target` 是**内容属性**，不进 URL |
| `languages` | R2 覆盖率的计算范围，缺省 = 全部已启用语言 |

```
content/topics/
  basics-javascript/   basics-python/   basics-java/       # 基准级 3 套（每个基准候选一套）
  js2python/  js2java/  js2go/  js2rust/  python2java/  java2python/
    ├─ 01-functions.yaml   ← 迁移教程（章节）              # 对级：规划 12 个方向
    ├─ pitfalls.yaml       ← 迁移陷阱（数组，loader 跳过）  #   = 3 基准 × 4 目标
    ├─ glossary.yaml       ← 速语词典（数组）              #   当前登记 6 个
    └─ roadmap.yaml        ← 迁移学习路线（数组）
content/concepts/concepts.yaml                              # 心智模型对照表（与基准无关，全局）
```

- **列表型资源与章节同放一个目录**，靠 `core.ts` 的 `Array.isArray(raw)` 约定区分 —— 一行 loader 改动都不需要。
- **pair 归属由目录名反查 registry 得到，不写进每条 YAML**：同一条陷阱可能在多个方向成立，逐条写 pair 字段会产生 12 份会各自漂移的副本。目录名对不上 registry 的由 R5 拦住。
- `equivalence` **相对本 topic 的基准**（ADR-24）：同一 feature 在 `basics-javascript` 与 `basics-python` 下是两条独立内容，各有各的徽章。基准列自己的徽章恒为 `identical`（有测试钉住），且**页面上不渲染它**（自指、零信息量）。

### 2.1 URL 里只有基准，没有目标语言（ADR-26 / ADR-27）

```
/compare/<基准>/basics/<章节>        列 = 基准 + 页内多选的对比语言
/compare/<基准>/migration/<章节>     列 = [基准, 目标]，目标由页内选择条单选
/compare/<基准>/pitfalls | glossary | roadmap
```

- **基准进 URL**：每个基准是一套独立内容，要能预渲染、能分享。
- **目标不进 URL**：它是"我现在想看哪个方向"，由每个板块页内的 [CompareLanguageBar](src/components/compare/CompareLanguageBar.vue) 决定。
- **两个语言控件分居两处**（ADR-27）：基准平铺在顶栏（[BaselineTabs](src/components/ui/BaselineTabs.vue)，单选，点击即导航）；对比语言下沉到各板块页内 —— **基础语法是多选**（`compareLangs`），**其余四个板块是单选**（`preferredTarget`，跨板块共享）。控件形态本身（多选框 / 单选）就在说明这个板块是"多列并排"还是"一篇文章"。
- 对级板块缺内容的方向**仍然列出，只是置灰不可选**（判据 `pairTargetsOf(基准, 板块)`）。
- 目标由 [resolvePairTarget](src/content/repository.ts) 推导：**最近挑的那门 → 已勾选里第一个该板块有内容的 → 该板块第一个可用方向**。只有确实有内容的方向会被选中。
- **目标不进 URL 的直接后果**：换方向不产生导航，路由守卫不会重跑。所以对级视图必须用 [usePairPayload](src/composables/usePairPayload.ts) 或内容 store 的 [ensurePair](src/stores/content.ts) **按需加载** —— 它不在 repository 里，别去那里找。只靠守卫的话页面会静默变成空白（这是实现期真踩到的 bug）。迁移页换方向还可能落在"新方向没有这一章"上，由 [ChapterCompareView](src/views/ChapterCompareView.vue) 里的 watcher 回落到该方向首章。
- 守卫里要算目标时**必须传路由里的基准**：守卫跑在 App 的路由 watcher 之前，`effectiveBaseline` 那时会落到 localStorage 的"上次选择"上，用错基准就会加载另一套分片。同理，`CompareLanguageBar` 用 `section` prop 而不是 `routeSection`。

### 2.2 加内容的操作路径

**加一个板块**（不需要改散落的代码）：在 `registry.yaml` 的 `sections:` 段声明一条（`shape` / `scope` / `columns` / `order` / `seo` 模板），再建内容目录、在 `topics:` 登记一个属于它的 topic。`shape: chapter` 的新板块**零代码**（自动复用 `ChapterCompareView`）；`shape: list` 的若复用已有渲染器（写已有的 `renderer` 名）也零代码，只有全新交互才需在 [SectionDispatchView](src/views/SectionDispatchView.vue) 的 `RENDERERS` 里加一行。`npm run verify:sections` 是这条承诺的可执行断言。逐步操作见 [docs/内容书写标准.md](docs/内容书写标准.md) §5。

**加一个 feature**：在 topic 的章里加一条 → 该 topic 的 `languages` 范围内每门语言各加一条同 `featureId` 的实现（R2 的覆盖率缺口是 error 级，缺一格就阻断；同一条规则另有 warn 分支，例如 `equivalence: absent` 却给了代码 —— 提示确认那是惯用替代写法）。

**加一个 (基准, 目标) 方向**：建 `content/topics/<baseline>2<target>/`，在 registry 登记 `section: migration` + `baseline` + `target` + `languages: [baseline, target]`，再写章节与三份列表。左栏、路由、sitemap 全部自动跟上。

**加一门语言**（不需要改任何组件/类型/路由）：
1. `cp -r content/languages/_template content/languages/<id>`，`meta.id` 必须等于目录名
2. 在 `content/registry.yaml` 登记并 `enabled: true`
3. `npm run content:build && npm run verify:ext`
4. 若它要当基准：在该语言 `meta.yaml` 标 `baseline: true`，并补一套 `basics-<id>/`

`LanguageId` 类型由 [scripts/build/generate-registry.ts](scripts/build/generate-registry.ts) 扫描目录生成；[scripts/verify-extensibility.ts](scripts/verify-extensibility.ts) 是"零代码改动"这句承诺的可执行断言。

### 3. 契约与校验

- **类型唯一真源**：[src/schemas/index.ts](src/schemas/index.ts)（Zod）。`src/types/index.ts` 只做 `z.infer` 再导出，禁止手写 interface。`src/` 侧只 `import type`，校验代码不进客户端包。
- **校验规则 R1–R17** 全部在 [scripts/lib/analyze.ts](scripts/lib/analyze.ts)（R1 结构 / R2 覆盖率 / R3 provenance / R4·R9 @note / R5 引用完整性 / R6 发布门槛 / R7 URL 白名单 / R8 命名 / R10 许可台账 / R11 差异有说明 / R12 基准列不点名他语言 / R13 featureId 前缀 / R14 板块成员资格 / R15 覆盖层 topic 声明 / R16 code 与 blocks 二选一 / R17 校对记录）。R9 从不单独出现，只以组合 id `R4/R9` 出现；R1 的结构判定主要由 loader（`core.ts` 的 Zod 解析）执行，analyze 侧只补 `concept.entries` 非空这类语义检查。R11 / R12 / R17 是 warn 级（不阻断构建）。R14 与 R16 落在 schema 层（`registrySchema.superRefine` 与 `refineSnippet`），因为它们是**单条数据自身的自洽性**，不需要跨文件视野。
  - 三轴相关的判据集中在两处：R5 管「topic 引用未知语言 / 对目录反查 / 对级词典只讲本方向两门语言」，R8 管「topic 目录与 registry 一一对应 / `defaultCompareLanguage` 已启用且 ≠ 基准 / basics 的 baseline 必须是基准候选」。
  - **R11 与 R12 是 warn 级（不阻断构建）**：R11 管「`equivalence` 非 `identical` 却一条注记都没配」，R12 管「基准列的注记点名了屏幕外的语言」——basics 是多选列，基准列讲第三方语言就是幽灵语言；对级板块只有两门语言，那里只禁「第三门」。匹配器在 [scripts/lib/lang-mention.ts](scripts/lib/lang-mention.ts)，注意 `JavaScript` 含 `Java`、`Go` 会撞英文动词这两个坑。
- **validate 与 build 共用同一份 `analyzeContent()`**。改校验逻辑只需改这一处，但要注意：脚本被改坏时测试未必发现，`tests/pipeline/content-contract.test.ts` 与 `tests/unit/section-model.test.ts` 对**真实 content 目录**断言不变量，是第二道闸门（见「测试地图」）。
- **`equivalence` 的参照系是本 topic 的基准**（ADR-24）。旧的全局常量 `equivalenceReference` 已删除；页面上那句"徽章以本页基准 X 为参照系"由 [EquivalenceBaselineNote.vue](src/components/compare/EquivalenceBaselineNote.vue) 渲染。基准列自己恒为 `identical`（它就是参照系），所以**基准列不渲染徽章**（`CodeBlock` 的 `isBaseline` prop，列头已有「基准」标记）——那枚 `=` 是自指、零信息量。

### 4. 内容里的两个约定

**`@note` 内联标记**：差异说明写在代码注释里，不用行号锚定（行号会随编辑静默漂移）。标记必须出现在该语言自己的行注释前缀（`meta.comment.line`，如 `//` / `#`）之后，位置不限：

```python
count = 0            # @note 赋值即声明，没有 let / const
MAX_RETRY = 3        # @note! 全大写只是约定，解释器不会阻止你重新赋值
```

构建期 [extractNotes](scripts/lib/core.ts) 抽取时**只剥掉标记本身**：`@note` 与 `@note!` 的说明**都留在代码行内**贴着那一行读。高危项曾被单独抽进代码块下方的说明栏，实践下来读者要在代码和说明栏之间来回跳，反而切断阅读，因此取消了这个出口。现在 `@note!` 与 `@note` 的差别只是说明前多一个 `⚠` 字符（与注释同色、不额外着色，且**随 `code` 一起被复制**）。`snippet.notes` 仍是 `allNotes` 里 tone 为 `warn` 的结构化副本，但页面不渲染它。副作用有二：① 搜索索引用的是 `ExtractResult.allNotes`（全部注记文本，是内容里检索价值最高的部分），别只取 `notes`；② 注记行**行数绝不能变**（行级 diff 与就近阅读靠它对位），首尾空行裁剪只认剥离前的范围。标记前缀写错会被 R4/R9 拦住。

**`equivalence` 四态**是"**与本 topic 的基准**是否不同"的唯一判据，不提供相似度百分比（跨语言 diff 恒在低区间，是伪精度）：

| 值 | 含义 | 界面 |
| --- | --- | --- |
| `identical` | 同构，几乎可直接迁移 | `=` 绿 |
| `analogous` | 形似但有差异 | `≈` 琥珀 |
| `divergent` | 语义不同，陷阱高发 | `≠` 红 |
| `absent` | 该语言没有这个概念 | `∅` 灰 |

`absent` **可以**给代码（表示"没有等价语法，这是惯用替代写法"），但必须用 `body` 说明。

### 5. 构建期做重活，运行时只消费产物

- **Shiki 构建期预高亮**，用 `css-variables` 主题（单份 HTML，明暗靠 CSS 变量切换）。Shiki / markdown-it / zod / js-yaml 都是 devDependency，**不进客户端包**。主题必须显式 `createCssVariablesTheme()` 创建；它不输出 font-style/weight，靠 [src/styles/base.css](src/styles/base.css) 的属性选择器补偿，补偿失效时 [scripts/lib/render.ts](scripts/lib/render.ts) 自动降级为双主题。
- **Markdown 走 markdown-it 且 `html: false`**（禁裸 HTML）—— 内容是 LLM 产出的，这是一条真实的注入路径。富文本一律构建期渲染成 HTML，运行时 `v-html` 只消费产物。
- **diff 刻意留在运行时**（[src/content/diff.ts](src/content/diff.ts)）：基准可切、对比列可多选、展示模式会变，预计算是几十种组合的浪费。用 `diffArrays` 逐行对齐，**不要换回 `diffLines`** —— 它会把相邻删除+新增合并成块，让完全相同的行也被标成"不同"（有回归测试）。
- **内容分片粒度是一章一个文件**（`src/generated/content/<topicId>/<chapter>.json`），由 [src/content/repository.ts](src/content/repository.ts) 用 `import.meta.glob` 懒加载。按 topic 分片会涨到 732 KB，别再改回去。
- **对级静态资源按对拆文件**（`src/generated/static/<baseline>--<target>.json` + 全局 `concepts.json`），同样懒加载。合成一个 `static.json` 会让 12 个方向的陷阱/词典/路线常驻主包，而用户一次只看一个方向。文件名能从 (基准, 目标) 直接推出来，客户端不做反查。
- **对比列按内容裁剪**：[pickColumns](src/composables/useVisibleColumns.ts) 把列裁到「本模块真有实现」的语言。对比列是用户偏好，覆盖范围是内容属性 —— 不裁的话骨架期会出现整列"本模块不涉及该语言"的噪音。

### 6. SEO 与预渲染

`manifest.routes` 是**可索引路由的单点定义**，vite-ssg 预渲染与 `sitemap.xml` 共用它，因此不可能不一致。`manifest.pairs` 是「有哪些 (基准,目标) 方向」的单点定义，左栏、基准切换回落、死链防护共用它。**两者都由 [scripts/pipeline/04-build.ts](scripts/pipeline/04-build.ts) 生成** —— 别被 `npm run registry` 的名字骗了，[generate-registry.ts](scripts/build/generate-registry.ts) 只产出 `registry.gen.ts`（LanguageId 类型），不碰 routes / pairs。

`prerenderExtra`（预渲染但**不进 sitemap**）现在有三类：`/search`（结果是客户端渲染的，爬虫只会看到空输入框）、迁移方向的特性页（与所在章节页高度重叠，进 sitemap 是近重复内容）、以及旧地址（`/pitfalls`、`/glossary`、`/roadmap/:langId` —— 静态托管做不了 301，只能预渲染出外壳让 SPA 完成重定向）。

SEO 文案里出现的**目标语言是按运行时同一套规则算出来的默认方向**：地址里没有它，但预渲染出来的那一页确实在讲某个方向，两者必须一致。

`vite.config.ts` 的 `ssgOptions.dirStyle` **必须是 `nested`**（默认 `flat` 产出 `.html`，GitHub Pages 不做无扩展名解析 → 只有首页能打开）。构建最后一步 [scripts/build/finalize-dist.ts](scripts/build/finalize-dist.ts) 会逐路由验收 HTML 里是否真含该页内容（空壳预渲染在这里失败），并产出 `dist/404.html`。

### 7. 搜索：中文分词 + 按基准分片

**分词**：MiniSearch 基于空格分词，中文会**静默失效**（索引建得出来、查询也跑得动，就是搜不到）。`Intl.Segmenter` 实测不可靠（`'数组与列表'` → 丢掉「数组」），因此走 **bigram**（unigram + 相邻二元组），查询侧 `combineWith: 'AND'`。[src/content/search-tokenize.ts](src/content/search-tokenize.ts) **构建期与客户端共用同一份**（两边都经 [src/content/search.ts](src/content/search.ts) 中转）—— 两边分叉会导致同一个静默失败。

**分片**：内容按基准拆成三套后，同一个概念会有三条文档。索引因此按基准分片（`src/generated/search-index/<baseline>.json`），`SearchView` 按当前基准换分片，查询侧再用 `queryOptions(baseline)` 的 `filter` 兜一层（MiniSearch 的 `loadJSON` 不记住 options，必须显式传）。`baseline: ''` 表示与基准无关（心智模型对照表），每个分片都收。预算口径是**单分片** ≤ 90 KB(gz)（`SEARCH_INDEX_BUDGET_KB` 在 [04-build.ts](scripts/pipeline/04-build.ts)）。注记文本（`ExtractResult.allNotes`，含留在代码注释里的普通项）**全部进索引** —— 它们是内容里检索价值最高的部分（"改内容会传染，改绑定不会"这类可背诵的结论就写在注记里）。

## 测试地图

`npm test` = `vitest run`。8 个文件按"钉住什么"分两类：

| 文件 | 钉住的不变量 |
| --- | --- |
| [tests/pipeline/content-contract.test.ts](tests/pipeline/content-contract.test.ts) | **对真实 `content/` 跑 `analyzeContent()`**：无 error、覆盖率、provenance、许可台账、@note 残留、feature id 前缀 |
| [tests/unit/section-model.test.ts](tests/unit/section-model.test.ts) | **对真实 content + 真实 `src/generated/` 分片**断言三轴模型：基准列徽章恒 `identical`、语言引用、缺口 |
| [tests/unit/baseline-switch.test.ts](tests/unit/baseline-switch.test.ts) | 基准候选与默认值、可见列计算、目标语言推导、切基准回落、diff 缓存、manifest 来源 |
| [tests/unit/diff.test.ts](tests/unit/diff.test.ts) | `compareToBaseline` 的行级对齐与缓存 |
| [tests/unit/extract-notes.test.ts](tests/unit/extract-notes.test.ts) | `extractNotes` 的 `notes`（仅高危）/ `allNotes`（全部）分流契约 |
| [tests/unit/lang-mention.test.ts](tests/unit/lang-mention.test.ts) | R12 的语言点名检测器（`JavaScript` 含 `Java`、`Go` 撞英文动词） |
| [tests/unit/redirects.test.ts](tests/unit/redirects.test.ts) | 旧地址 → 新地址的重定向 |
| [tests/unit/search.test.ts](tests/unit/search.test.ts) | 中文 bigram 分词、检索、文档构造、按基准分片过滤 |

前两个**读真实内容目录与真实构建产物**，因此它们既是回归测试、也是内容契约的第二道闸门 —— 改 `analyze.ts` 的判定逻辑时，会先在这两处红。

## 编辑内容时的硬约束

- 新增内容默认 `review.state: draft`；`registry.publishPolicy` 为 **`include-draft-with-badge`**（当前值）时 draft 可构建但页面必须显示"未经人工校对"；切到 `reviewed-only` 时 draft 直接**阻断构建**（R6）。新增大批量 AI 生成内容时先确认策略。
- `provenance.origin: 'llm'` **刻意不填 `license`** —— 模型输出不产生可署名许可，强填 MIT/GFDL 是错误陈述。合规责任由 `review.state` + 页面标记 + 许可台账承担。台账模板在 [scripts/lib/analyze.ts](scripts/lib/analyze.ts) 的 `LEDGER_TEMPLATE`，只登记实际被使用的来源。
- 以 `_` 开头的语言目录是**私有目录**，默认不参与构建与校验（`_template/`、`verify:ext` 的 `_fixturelang`）。新增真语言不要用下划线前缀。
- YAML 块标量（`code: |`）内部是代码原文，批量给标量加引号的脚本会误伤它们。
- **YAML 普通标量不能以反引号开头**（``title: `x` 是什么`` 会让整章解析失败），也不能写裸 `null`（`aliases: [null]` 会被解析成空值）。这两条都踩过。
- 对级板块的 trap/词典/路线**只能讲本方向的两门语言**（R5）：多写一门第三语言，读者会以为「带着当前基准的习惯」在那个方向也会踩到同样的坑。
- **基准列自己的 `equivalence` 必须是 `identical`**（有测试钉住）——它就是参照系。给出 `absent` 仅当基准语言里也没有这个概念。
- 所有外部 URL 必须是 `https`（R7）。
- **compare 路由里没有 topicId** —— 它由 `(基准, 板块, 目标)` 从 `manifest` 反查（[repository.topicIdOf](src/content/repository.ts)）。组件里不要拼 topic id 字符串，`verify:ext` 也会拦住写死的语言 id。唯一的例外是内容详情页 `/feature/:topicId/:slug`，那个 `:topicId` 是路径参数，不走反查。
- **面向用户的文案里不许写死语言名**：JS / Python / Java 三门基准**权重相同**，不是「以 JS 为主、其余为客」——`java2python` 页上写「JS 开发者必踩」就是错的（真踩过：`PitfallCard` 的徽章曾硬编码这四个字，于是三门基准的页面全在讲 JS）。语言名一律从 meta 取：i18n 里走 `{baseline}` 占位符（`pitfalls.fromBaselineBadge` 是样板），组件里由调用方以 prop 传入。`verify:ext` 的**第三道断言**守着这条：扫描 i18n 的**值**与 `.vue` 的 `<template>` 段（先摘掉 `<script>` 和 HTML 注释 —— 代码注释里拿语言举例是正常的），命中任何已启用语言的 `name` / `shortName` 即失败。注意它只认**显示名所在的文案位置**，第 2 道断言认的是**带引号的语言 id**，两者互补。

## 环境陷阱

- **`PC_BASE_PATH` 不带前导斜杠**：Git Bash / MSYS 会把以 `/` 开头的环境变量改写成 Windows 绝对路径，导致 Vite 报 `"base" option should start with a slash`。解析逻辑与提示在 [scripts/lib/env-paths.ts](scripts/lib/env-paths.ts)。不配 `PC_SITE_URL` 就不生成 sitemap（刻意的，错误的 `loc` 会污染索引）。
- **两个 workflow 监听 `main`，而本仓库当前只有 `master` 分支、也没有配置 remote**（[ci.yml](.github/workflows/ci.yml) / [deploy.yml](.github/workflows/deploy.yml) 的 `branches: [main]`）。按现状 push 不会触发 CI 与部署 —— 要么把分支名对齐成 `main`，要么改 workflow 里的 `branches`。别误以为"绿了"。
- **esbuild / rollup 原生二进制丢失**：npm 已知 bug（[#4828](https://github.com/npm/cli/issues/4828)）会静默跳过平台专用可选依赖，报错信息与真实原因完全无关。两个包已写进 `package.json` 的 `optionalDependencies`；仍复发则 `rm -rf node_modules package-lock.json && npm install`。
- `dist/`、`node_modules/` 见 `.gitignore`。

## 已知遗留

- **搜索索引的 `javascript` 分片 118 KB(gz)，超出 90 KB 红线**（§15.6.5 起就存在，拆成按基准分片后仍是最大的那份）。下一步按 ADR-21 的既定路径把 `text` 里的 `@note` 文本降级为 summary-only。**实测提醒**：全部注记文本仅 67 KB raw，只占 javascript 分片 652 KB raw 的约 9%，单靠砍注记到不了 90 KB —— 真正的路径是 summary-only 连 `feature.body` / `snippet.body` 一并去掉，或按 section 域内检索。**推翻信号**：降到 150 KB 仍不达标就改为按 section 域内检索，牺牲跨板块检索。
- **骨架期内容不完整，目前只有「JavaScript 基准 + Python 对比」一套算完整模板**：Python / Java 基准各只有 1 章基础语法、各只有 1 个迁移方向，6 个迁移方向也都只有 1 章教程（`01-functions`，5 个 feature 的样板）。R5 会按基准汇总一条 warn 列出缺哪些方向（刻意是 warn 不是 error，否则补齐内容前构建一直是红的）。**补内容时照下面这三处抄形态**（数字用 `npm run content:report` 复核）：

  | 维度 | 完整的那一套 | 其余 |
  | --- | --- | --- |
  | 基础语法章节 | [basics-javascript](content/topics/basics-javascript/) **8 章 × 9 feature = 72**，5 门语言各 72 条实现 | [basics-python](content/topics/basics-python/) / [basics-java](content/topics/basics-java/) 各 **1 章**，且 `languages` 压到 2 门 |
  | 迁移方向列表 | [js2python](content/topics/js2python/)：陷阱 **10** / 词典 **10** / 路线 **5** | 其余 5 个方向：陷阱 2–4 / 词典 4 / 路线 3 |
  | 人工校对（reviewed） | [python](content/languages/python/) 的 `01~08` **72/72 全 reviewed** | [javascript](content/languages/javascript/) 39/72（07-control-flow 只 1 条、08-functions 只 3 条）；java / rust / go **全 draft** |

  两个"完整"不是一回事：`basics-javascript` 是**章节结构**最全（唯一填满 8 章的基准级板块），**Python 列**是**校对完成度**最高（也是全站唯一逐条实跑验证过的语言）—— 迁移板块的实际样板是 `js2python`。Rust / Go 是 `baseline: false`，只能当对比列。
