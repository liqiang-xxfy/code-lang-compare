# code-lang-compare

多语言并排对比学习工具。选一门**基准语言**（JavaScript / Python / Java，默认 JS），勾选若干**对比语言**，沿各板块并排看每一门「和基准差在哪」，**突出差异**，让已有知识快速迁移。

```
顶栏：☰ · 站点名 · 首页 · 多语言对比 · 速查 · 内容来源
左侧（「多语言对比」的子菜单，顶栏 ☰ 可开合）：
  基础表达 → 数据与抽象 → 语言机制 → 工程实践 → 迁移陷阱 → 速语词典 → 迁移学习路线

每个板块页内：以 X 为基准 · [Y][Z][…]  ← 章节型板块多选，速查三兄弟单选
```

**左栏的章节分类随基准变**。上面前四项是按「迁移者先关心什么」划的四个板块，而**每个板块里有哪些章、
叫什么、什么顺序**是**每个基准各一份**的：以 Python 为参照系时看到的是 Python 心智模型下的组织方式，
换成 Java 就是另一套。同一批知识点因此可以落在不同的章里，而内容只写一份。

**基准与对比语言分开**：基准平铺在顶栏、单选、点击即切换；对比语言在**每个板块页内**——章节型板块是多选（勾几门并排几门），速查三兄弟是单选（逐方向撰写，一门目标 = 一篇文章）。控件形态本身就说明了这个板块是哪种。

**基准不是"一个可以随手切的视角"，而是内容维度**：同一门语言，从 JavaScript 出发和从 Python 出发要讲的东西不同（"带着 JS 习惯写 Go" ≠ "带着 Python 习惯写 Go"）。所以每个基准有各自的地址（`/compare/<基准>/...`），都能预渲染、能分享。

**基准固定为三门，不增减**：加一个基准等于让**每一门语言**各补一份差异说明，是 N 倍成本；定死之后 `vs` 的 key 集合封闭，内容总量可预估。

---

## 快速开始

```bash
npm install
npm run dev            # 先编译内容，再起开发服务器
```

其他常用命令：

```bash
npm run content:validate   # 只跑校验（CI 的阻断闸门）
npm run content:build      # 内容编译：校验 + 生成 src/generated/*
npm run content:report     # 覆盖率 / 审阅状态 / 待校对清单
npm run typecheck          # vue-tsc 类型检查
npm test                   # 单元测试
npm run verify:ext         # 验证「加语言只加数据」的承诺
npm run verify:sections    # 验证「加板块只加数据」的承诺
npm run build              # 内容编译 + 预渲染 + SEO 收口 → dist/
npm run preview            # 本地预览 dist/
```

---

## 这个项目的四条核心设计

### 0. 内容按**语言**组织，章节分类按**基准**各来一份

**一个知识点在一门语言下的全部内容 = 一个「对比框」**，三个槽位：① 代码 ② 注释（代码内联的 `@note`）③ 说明。

第 ③ 槽是**唯一按角色变化的槽位**：这门语言此刻是**基准列**时用 `baseline`（它自己是什么），是**对比列**时用 `vs.<当前基准 id>`（它和当前基准差在哪）。

```
content/
  catalog/<板块>/features.yaml           ← ① 池：这个板块有哪些知识点（与基准无关）
  catalog/<板块>/<基准 id>.yaml           ← ② 分组：该基准怎么把它们讲给读者听
  languages/<语言>/<板块>/<group>.yaml    ← ③ 内容：boxes，key = 池里的 feature id
  pairs/<基准>2<目标>/{pitfalls,glossary,roadmap}.yaml  ← ④ 唯一保留方向性的内容
```

**存放单位（`group`）与展示单位（章节）是分开的**，这是第 ① 与第 ② 层能拆开的原因，也是「**改章节分类不用动任何内容文件**」的原因：同一个知识点在 JS 视角下可以落在「对象与原型」章、在 Python 视角下落在「类与继承」章，而它的内容只写一份。

**同一门语言要为每个基准各写一份差异解释**（视角无法互相推导，这是本架构的主要成本），换来的是**加语言从 N 倍降为常数**、且不再有会各自漂移的方向副本。而章节分类的自由度**不在这笔账里** —— 它只决定同一个知识点摆在哪个位置。

**地址里只有基准，没有目标语言**：`/compare/javascript/express/bindings` 不指定对比哪几门，它由页内的勾选决定。基准进 URL 是因为每个基准是一套独立的浏览语境（要能预渲染、能分享）；对比语言不进 URL 是因为它是"我现在想看哪几门"——写进地址会让同一份内容散成几十个地址。

**速查三兄弟是唯一的例外**：陷阱 / 词典 / 路线的主语本就是**方向**（「带着 JS 习惯写 Python 会踩的坑」换成「Python 的坑」就丢掉了最有价值的那半句），所以它们留在 `content/pairs/` 下按方向组织。

### 1. 内容只有一个真源：`content/`

```
content/**/*.yaml  ──[validate → build]──▶  src/generated/**  ──▶  视图
     （人编辑）                                 （机器生成，禁止手改）
```

`.yaml` 是唯一的人工编辑入口。`src/generated/` 里的东西全部是构建产物，跨过这条分界线只能由 `npm run content:build` 单向完成。

**为什么不让浏览器直接读 YAML**：那会同时存在两条取数路径（dev 下读 YAML、build 下读产物），改了 YAML 但忘了重建时，本地看到新内容、线上看到旧内容 —— 这种「幽灵内容」是最难查的一类问题。

### 2. 一个概念只有一个实体

| 你可能想建的字段 | 实际做法 | 原因 |
| --- | --- | --- |
| `flags.differs` | 用 `equivalence` 四态推导 | 手写标记与计算出的相似度会互相打架 |
| 相似度百分比 | 不提供 | 跨语言 diff 恒在低区间，是伪精度；只显示「有 N 行不同」 |
| `Feature.kind: 'pitfall'` | 用 `Pitfall` 实体 + `featureId` 反查 | 同一个坑不该有两份内容 |
| `weight` | 清单里 `features` 的数组顺序 | 一个可被忽略的字段 |
| `LanguageMeta.status` | 只由 `content/registry.yaml` 的 `enabled` 控制 | 两个开关控同一件事必然冲突 |
| 章节文件名带序号 | 章节 id 由该基准的分组文件自己声明，顺序由数组位置表达 | 序号会在中间插一章时让后续全体改名 |

### 3. 高亮与 Markdown 都在构建期完成

Shiki 是 devDependency，**不进客户端包**。用的是 `css-variables` 主题 —— 一份 HTML，明暗靠 CSS 变量切换，产物体积约为「双主题各一份」的一半。

> 已知限制：`css-variables` 主题只输出颜色，不输出字重/字形。这里用 CSS 属性选择器补偿
> （`span[style*='--shiki-token-comment'] { font-style: italic }`），见 `src/styles/base.css`。
> 若哪天该补偿失效，`scripts/lib/render.ts` 会自动降级为双主题输出，并在构建日志里明说。

Markdown 走 `markdown-it`，**`html: false`**（禁裸 HTML）—— 因为内容里有 LLM 产出，这是一条真实的注入路径。

---

## 内容怎么写

### 加一个知识点（最高频）

1. 在 `content/catalog/<板块>/features.yaml` 的池里加一条（id 是**板块内唯一**的 kebab-case slug），并给它一个 `group`（**存放组** = 内容文件名）
2. 在**想展示它的**基准的 `content/catalog/<板块>/<基准 id>.yaml` 里，把它加进某一章的 `features`
3. 在 `content/languages/<语言>/<板块>/<group>.yaml` 的 `boxes` 里加一条同名的 key
4. 跑 `npm run content:validate` 看缺口，`npm run dev` 看效果

> **只想在某个基准下展示，就只改那一份分组** —— 池与内容都不用动。反过来，
> **调章节名 / 换顺序 / 重新分组**也只改分组文件，一个内容文件都不用碰。

> **「还没写」与「本语言没有这个概念」是两回事**：前者是键缺失（渲染成更淡的留白），
> 后者要显式写 `absent: true`（渲染成灰格 +「本语言无此概念」）。少了这个区分，
> 读者会把「语言之间没有这个差异」误读成「这里内容缺失」。

**完整的内容书写规范见 [docs/内容书写标准.md](docs/内容书写标准.md)；架构的来龙去脉见 [docs/对比内容架构.md](docs/对比内容架构.md)。**

### 在代码里标差异：`@note`

差异说明**写在代码里**，不在外面按行号锚定 —— 行号会随代码编辑静默漂移，而内容准确性是最高风险项。

```js
// JavaScript：用该语言自己的行注释符
let n = 1;
n = 2;                 // @note let 的绑定可以改
const list = [1, 2];
list.push(3);          // @note! const 只冻结绑定，数组内容照样能改
```

- `@note  …` → 一般差异说明，**留在代码注释里**，贴着那一行读
- `@note! …` → 高危陷阱，同样留在行内，只是说明前多一个 `⚠` 标记
- 标记必须紧跟在该语言的注释前缀之后（`meta.comment.line`），否则校验会报 `R4/R9`

构建期抽取**只剥掉标记本身**，说明文本原样留在代码行里 —— 不另设说明栏，读者不必在代码与注释之间来回跳。

### `equivalence` 四态（按基准分）

```
equivalence:
  javascript: divergent     # 缺 key = identical
  java: analogous
```

| 值 | 含义 | 界面 |
| --- | --- | --- |
| `identical` | 同构：语义与写法几乎可直接迁移 | `=` 绿 |
| `analogous` | 形似：结构相近但有关键差异 | `≈` 琥珀 |
| `divergent` | 语义不同：看起来像，行为不同（陷阱高发区） | `≠` 红 |
| `absent` | 该语言没有这个概念 | `∅` 灰 |

徽章以**本页的基准**为参照系，所以它按基准分。基准列自己**不渲染**徽章（那枚 `=` 是自指、零信息量）；`absent` 的格子恒为 `∅`。

### 加一门语言

1. 复制脚手架目录：`cp -r content/languages/_template content/languages/<新语言 id>`，填 `meta.yaml`（`id` 必须等于目录名，去掉前导下划线）
2. 按板块填内容：`content/languages/<id>/<板块>/<存放组>.yaml`（文件名取自池里的 `group`）
3. 在 `content/registry.yaml` 里登记并 `enabled: true`
4. `npm run content:build && npm run verify:ext`

**不需要改任何组件、类型或路由代码** —— `LanguageId` 是由 `scripts/build/generate-registry.ts` 扫描目录生成的。`npm run verify:ext` 就是这条承诺的可执行断言：它真的造一门临时语言，然后断言 `src/`（不含 `generated/`）里没有任何代码提到它。

新语言一律是**对比列语言**（基准固定三门），所以写全三份 `vs` 即可，不必写 `baseline`。

> **私有目录约定**：以 `_` 开头的语言目录默认不参与构建与校验。
> `_template/` 是供复制的脚手架；CI 的临时语言也用这个前缀，这样即便脚本被中断留下残留，
> 也不会让整个仓库的校验失败。（这个约定是踩出来的。）

---

## 审阅状态与发布策略

每条内容带 `review.state`（`draft` → `reviewed` → `verified`）与 `review.provenance`，可写在**文件级**（整章的默认值）或每一格里（覆盖文件级）。

发布策略在 `content/registry.yaml` 里切换：

| 策略 | 行为 |
| --- | --- |
| `include-draft-with-badge`（**当前**） | draft 参与构建与索引，但页面上必须显示「未经人工校对」 |
| `reviewed-only` | 严格模式：draft 会**阻断构建** |

同时注意 `provenance` 的一个刻意设计：**`origin: 'llm'` 不填 `license`**。模型输出不产生可署名的许可，强填 MIT / GFDL 是错误陈述，比留空更危险。合规责任由「人工审阅记录 + 页面上的未校对标记」承担。

许可台账在 `/attributions`，它回答三个问题：这个许可要求我做什么、我在哪履行了、用在了哪些条目上。缺失履行位置会被 `R10` 阻断。

---

## 部署（GitHub Pages）

```bash
PC_SITE_URL=https://<user>.github.io PC_BASE_PATH=code-lang-compare npm run build
```

两个变量：

- `PC_BASE_PATH` —— 项目页的子路径，**不写前导斜杠**（写 `code-lang-compare`，不是 `/code-lang-compare/`）。
  不配的话资源与深链全部 404。不带前导斜杠是刻意的：**Git Bash（MSYS）会把以 `/` 开头的环境变量自动转成 Windows 绝对路径**
  —— `PC_BASE_PATH=/` 会变成一条 `C:/Program Files/Git/...` 之类的路径，直接让 Vite 报 `"base" option should start with a slash` 并构建失败。
  `scripts/lib/env-paths.ts` 会识别这种被改写的值并给出提示。
- `PC_SITE_URL` —— 用于 canonical 与 `sitemap.xml`。**不配就不生成 sitemap**，这是刻意的：错误的 `loc` 会污染搜索引擎索引。

两个变量都带 `PC_` 前缀，避免与宿主环境里同名的通用变量冲突。

构建链里有两个「不做就一定出事」的步骤，都已经写进 `npm run build`：

1. `dirStyle: 'nested'`（vite.config.ts）—— 产出 `/compare/javascript/express/bindings/index.html`。默认的 `flat` 会产出 `.html` 后缀文件，而 GitHub Pages 不做「无扩展名 → .html」的解析，结果就是**只有首页能打开**。
2. `dist/404.html`（scripts/build/finalize-dist.ts）—— GitHub Pages 没有 rewrite，深链直接命中 404 时必须回落到 SPA。

构建最后还会**验收**两条：每条路由的 HTML 里必须含该页内容文本，且**不含「加载中…」**（后者是「页面结构在、内容没预渲染出来」这一类空壳的探针）。

---

## 排障

### `npm install` 后构建报 esbuild / rollup 找不到原生二进制

npm 有一个已知 bug（[#4828](https://github.com/npm/cli/issues/4828)）：当 `node_modules` 与 lock 文件状态不一致时，会**静默跳过**平台专用的可选依赖。症状：

- `require('esbuild')` → `The package "@esbuild/win32-x64" could not be found`
- `rollup` → `Cannot find module @rollup/rollup-win32-x64-msvc`

这两个包已显式写进 `package.json` 的 `optionalDependencies`，正常情况下不会再复发。若仍遇到：

```bash
rm -rf node_modules package-lock.json && npm install
```

> 这个坑值得单列，是因为它的**失败信息与真实原因完全无关**。

## SEO（硬需求）

纯 CSR 对不执行 JS 的爬虫等价于空页面，所以这里用 `vite-ssg` 在构建期对**每条路由**渲染出含真实内容的静态 HTML，CSR 只作为交互层。

- 路由清单来自 `src/generated/manifest.json` —— 预渲染与 `sitemap.xml` **共用同一份来源**，不可能出现「sitemap 里有但没预渲染」。
- 客户端导航时由 `usePageMeta` 更新同样的文案，保证用户看到与爬虫看到的一致。
- `index.html` 里预留了 CSP（当前是注释）。启用前请确认没有内联脚本被拦。

---

## 目录结构

```
content/                  # 【唯一人工编辑入口】
  registry.yaml           #   语言启用开关 + 基准/对比语言默认值 + 发布策略 + 板块注册表
  catalog/<板块>/          #   清单两层：
    features.yaml         #     池 —— 知识点清单（与基准无关）
    <基准 id>.yaml         #     章节分组 —— 该基准怎么讲（名称/分组/顺序/取舍）
  languages/<语言>/        #   内容：<板块>/<存放组>.yaml（boxes，key = 池里的 feature id）
    meta.yaml             #     语言元信息（注释符驱动 @note 解析、shikiLang 驱动高亮、baseline 候选资格）
  pairs/<基准>2<目标>/      #   速查三兄弟：pitfalls / glossary / roadmap（唯一保留方向性的内容）
  languages/_template/    #   新增语言时复制的脚手架（`_` 前缀 = 私有目录）
  i18n/zh-CN.yaml         #   界面文案（内容本身不做多语言）
content.legacy/           # 迁移前的旧内容存档，**不参与构建与校验**（对照旧写法用）
scripts/
  pipeline/               #   validate / build / report / search-index
  build/                  #   注册表生成、预渲染后处理
  lib/                    #   装载、@note 抽取、Markdown + Shiki 渲染、分析、环境变量
src/
  generated/              #   【构建产物，禁止手改】
    catalog.json                       # 每基准一份章节分组 + 与基准无关的 feature 索引（eager import）
    content/<语言>/<板块>/<存放组>.json  # 内容分片：一门语言 × 一个存放组
    static/<基准>--<目标>.json          # 速查三兄弟
    search-index/<语言>.json            # 搜索倒排索引，按语言分片
  schemas/                #   内容契约（Zod，唯一真源）
  content/                #   ContentRepository + boxView（双角色取值）+ 行级 diff + 搜索
  composables/            #   i18n / pageMeta / 持久化 / 基准切换回落 / 可见列裁剪
  components/             #   compare / code / content / ui
  views/                  #   路由视图
  styles/                 #   tokens（明暗 × 密度）+ base
tests/                    #   单元 + 内容契约测试
```

**内容分片粒度是「一门语言 × 一个存放组」**。章节分类按基准各一份，所以章节标题/顺序走 `catalog.json`（小、eager）；格子的内容按语言与存放组拆开懒加载，一个章节页按「可见列 × 本章引用的存放组」加载若干份，再合并成一门语言一份的格子表。

---

## 搜索

在构建期生成倒排索引（`scripts/pipeline/search-index.ts`），客户端**进 `/search` 才下载**、不进主包。

**中文是这里唯一的真问题。** MiniSearch 基于空格分词，而中文没有空格 —— 直接用会**静默失效**：索引建得出来、查询也跑得动，就是搜不到。

第一反应是 `Intl.Segmenter`，但实测它在中文上不可靠：

```
'数组与列表'   → ['数','组','与','列表']      ← 「数组」这个整体直接丢了
```

所以中文走 **bigram**：每个字单独出一个 token，再把相邻两字组成二元组 —— 任意两字词组都必然出现在索引里，既不需要词典也没有切分歧义。查询侧配 `combineWith: 'AND'`，否则搜「数组」会把所有含「数」的条目都捞出来。

拉丁词与代码符号按原样保留（`?.`、`??=` 是真实的检索需求）。分词实现在 `src/content/search-tokenize.ts`，**构建期与客户端共用同一份** —— 两边分叉会导致同一个静默失败。

**索引按语言分片**（`src/generated/search-index/<语言>.json`）：内容本来就按语言组织，所以一门语言的文字只索引一次（总量 ≈ 1×）。客户端加载**当前可见的那几门**，于是「搜到的」与「屏幕上能看到的列」天然一致，查询侧不需要再过滤。速查三兄弟归入**目标语言**的分片（「带着 A 习惯写 B 会踩的坑」讲的是 B）。

索引收入的是**注记文本 + 说明文本**，不含代码原文 —— 注记是内容里检索价值最高的部分（「const 冻结的是绑定，不是对象」这类可背诵的结论就写在注记里）。

## 已知边界（首期不做）

在线运行代码（只留 `Runner` 接口）、内容多语言、账号与云同步、行虚拟化（用 `content-visibility` + CSS 裁剪替代）。

## 许可

本站代码与 `origin: manual` 的原创内容采用 **MIT**。引入的外部内容按各自许可处理，见 `/attributions` 页面与内容里的 `provenance` 字段。
