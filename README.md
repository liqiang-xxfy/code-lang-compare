# code-lang-compare

多语言并排对比学习工具。选一门**基准语言**（默认 JavaScript，也可选 Python / Java），沿五个板块并排对照目标语言，**突出差异**，让已有知识快速迁移。

```
顶栏：☰ · 站点名 · 首页 · 多语言对比 · 速查 · 内容来源
左侧（「多语言对比」的子菜单，顶栏 ☰ 可开合）：
  基础语法 → 迁移教程 → 迁移陷阱 → 速语词典 → 迁移学习路线

每个板块页内：以 X 为基准 · [Y][Z][…]  ← 基础语法多选，其余四个单选
```

**基准与对比语言分开**：基准平铺在顶栏、单选、点击即切换；对比语言在**每个板块页内**——基础语法是多选（勾几门并排几门），迁移教程、陷阱、词典、路线是单选（逐方向撰写，一门目标 = 一篇文章）。控件形态本身就说明了这个板块是哪种。

对标基线是 [hyperpolyglot.org/scripting](https://hyperpolyglot.org/scripting)，但补上了它缺的四件事：语言列可勾选、三种对比视角、差异标记、移动端可用。

**基准不是"一个可以随手切的视角"，而是内容维度**：同一门语言，从 JavaScript 出发和从 Python 出发要讲的东西不同（"带着 JS 习惯写 Go 会踩什么" ≠ "带着 Python 习惯写 Go"）。所以每个基准有各自的一套内容与地址（`/compare/<基准>/...`），都能预渲染、能分享。

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
npm run build              # 内容编译 + 预渲染 + SEO 收口 → dist/
npm run preview            # 本地预览 dist/
```

---

## 这个项目的四条核心设计

### 0. 内容按 (基准, 目标) 对组织，只有五个板块

`content/topics/` 下每个目录是一个 topic，它在 `registry.yaml` 里声明 `section` / `baseline` / `target` 三个字段：

```
basics-javascript/  basics-python/  basics-java/     ← 板块一「基础语法」：基准级，一套一个基准
js2python/  python2java/  …（共 12 个方向）            ← 其余四个板块：每个 (基准,目标) 对一个目录
  ├─ 01-functions.yaml   迁移教程（章节）
  ├─ pitfalls.yaml       迁移陷阱
  ├─ glossary.yaml       速语词典
  └─ roadmap.yaml        迁移学习路线
```

**基础语法是唯一没有 `target` 的板块** —— 它的列由页内的多选决定；其余四个板块是逐对撰写的，换一门目标语言等于换一篇文章。

`equivalence` 徽章（= ≈ ≠ ∅）以**本 topic 的基准**为参照系：同一个特性在 `basics-javascript` 与 `basics-python` 下是两条独立内容，各有各的徽章。

**地址里只有基准，没有目标语言**：`/compare/javascript/pitfalls` 不指定方向，方向由页内选择条决定。基准进 URL 是因为每个基准是一套独立内容（要能预渲染、能分享）；目标不进 URL 是因为它是"我现在想看哪个方向"——写进地址会让同一份内容散成 12 个地址，而且基础语法（多列）与对级板块（一篇文章）会出现两套互不相容的 URL 语义。

### 1. 内容只有一个真源：`content/`

```
content/**/*.{yaml,md}  ──[validate → build]──▶  src/generated/**  ──▶  视图
        （人编辑）                                    （机器生成，禁止手改）
```

`.yaml` 与 `.md` 是唯一的人工编辑入口。`src/generated/` 里的东西全部是构建产物，跨过这条分界线只能由 `npm run content:build` 单向完成。

**为什么不让浏览器直接读 YAML**：那会同时存在两条取数路径（dev 下读 YAML、build 下读产物），改了 YAML 但忘了重建时，本地看到新内容、线上看到旧内容 —— 这种「幽灵内容」是最难查的一类问题。

### 2. 一个概念只有一个实体

| 你可能想建的字段 | 实际做法 | 原因 |
| --- | --- | --- |
| `flags.differs` | 用 `equivalence` 四态推导 | 手写标记与计算出的相似度会互相打架 |
| 相似度百分比 | 不提供 | JS 与 Python 的跨语言 diff 恒在低区间，是伪精度；只显示「有 N 行不同」 |
| `Feature.kind: 'pitfall'` | 用 `Pitfall` 实体 + `featureId` 反查 | 同一个坑不该有两份内容 |
| `Problem` / `Solution` | 复用 `Feature` / `Snippet` | 结构与「一个特性的 N 语言实现」完全同构 |
| `weight` | `Chapter.features` 的数组顺序 | 一个可被忽略的字段 |
| `LanguageMeta.status` | 只由 `content/registry.yaml` 的 `enabled` 控制 | 两个开关控同一件事必然冲突 |

### 3. 高亮与 Markdown 都在构建期完成

Shiki 是 devDependency，**不进客户端包**。用的是 `css-variables` 主题 —— 一份 HTML，明暗靠 CSS 变量切换，产物体积约为「双主题各一份」的一半。

> 已知限制：`css-variables` 主题只输出颜色，不输出字重/字形。这里用 CSS 属性选择器补偿
> （`span[style*='--shiki-token-comment'] { font-style: italic }`），见 `src/styles/base.css`。
> 若哪天该补偿失效，`scripts/lib/render.ts` 会自动降级为双主题输出，并在构建日志里明说。

Markdown 走 `markdown-it`，**`html: false`**（禁裸 HTML）—— 因为内容里有 LLM 产出，这是一条真实的注入路径。

---

## 内容怎么写

### 加一个特性

1. 在 `content/topics/<topicId>/<NN>-<chapter>.yaml` 里加一条 feature（id 形如 `basics-javascript/var-declaration`）
2. 在 `content/languages/<lang>/snippets/<topicId>/<NN>-<chapter>.yaml` 里给该 topic 覆盖范围内的每门语言各加一条同 `featureId` 的实现
3. 跑 `npm run content:validate` 看缺口，`npm run dev` 看效果

> 实现是**一章一个文件**，且**按 topic 分目录** —— 文件名只表达「第几章」，归属由目录表达。
> 单文件在 72 个 Feature 的量级下会涨到千行以上：一次 PR 的 diff 覆盖整章、同文件必冲突。
> 文件顶层是对象（`topic` + 可选的文件级 `review` + `snippets[]`）。同批生成的条目
> provenance 往往逐字相同，写到文件级即可 —— 全仓库曾因此重复 456 处。

**完整的内容书写规范（加特性 / 章节 / 方向 / 板块 / 语言，`@note` 与 `equivalence` 的判据，多段代码，常见错误）见 [docs/内容书写标准.md](docs/内容书写标准.md)。**

### 在代码里标差异：`@note`

差异说明**写在代码里**，不在外面按行号锚定 —— 行号会随代码编辑静默漂移，而内容准确性是最高风险项。

```js
// JavaScript：用该语言自己的行注释符
const user = { name: "Ada" };
user.name = "Grace";   // @note! 允许：const 冻结的是绑定，不是对象内容
```

```python
count = 0            # @note 赋值即声明，没有 let / const 这类关键字
MAX_RETRY = 3        # @note! 全大写只是约定，解释器不会阻止你重新赋值
```

- `@note  …` → 一般差异说明，**留在代码注释里**，贴着那一行读
- `@note! …` → 高危陷阱，同样留在行内，只是说明前多一个 `⚠` 标记
- 标记必须紧跟在该语言的注释前缀之后（`meta.comment.line`），否则校验会报 `R4/R9`

构建期抽取**只剥掉标记本身**，说明文本原样留在代码行里 —— 不另设说明栏，读者不必在代码与注释之间来回跳。高危项靠那个 `⚠` 在满屏注释里被扫到；它是 `code` 的一部分，**复制代码时会一并带走**。

### `equivalence` 四态

| 值 | 含义 | 界面 |
| --- | --- | --- |
| `identical` | 同构：语义与写法几乎可直接迁移 | `=` 绿 |
| `analogous` | 形似：结构相近但有关键差异 | `≈` 琥珀 |
| `divergent` | 语义不同：看起来像，行为不同（陷阱高发区） | `≠` 红 |
| `absent` | 该语言没有这个概念 | `∅` 灰 |

`absent` 时**可以**给代码 —— 表示「没有等价语法，这是惯用替代写法」，同时必须用 `body` 说明。

### 加一个 (基准, 目标) 方向

1. 建目录 `content/topics/<baseline>2<target>/`，写迁移教程章节与（可选的）`pitfalls.yaml` / `glossary.yaml` / `roadmap.yaml`
2. 在 `content/registry.yaml` 的 `topics` 段登记：`section: migration` + `baseline` + `target` + `languages: [baseline, target]`
3. `npm run content:build` —— 左栏、路由、sitemap 全部自动跟上

> 三份列表资源与章节放在同一个目录里，靠 loader 的「数组 = 列表、对象 = 章节」约定区分。
> **归属由目录名反查 registry 得到，不写进每条 YAML**：同一条陷阱可能在多个方向成立，
> 逐条写 pair 字段会立刻产生 12 份会各自漂移的副本。

### 加一门语言

1. 复制脚手架目录：`cp -r content/languages/_template content/languages/<新语言 id>`，填 `meta.yaml`（`id` 必须等于目录名，去掉前导下划线）
2. 在 `content/registry.yaml` 里登记并 `enabled: true`
3. `npm run content:build && npm run verify:ext`
4. 若它要当基准：在它的 `meta.yaml` 里标 `baseline: true`，补一套 `content/topics/basics-<id>/`，并在 `registry.yaml` 补它与其它语言的各个方向

**不需要改任何组件、类型或路由代码** —— `LanguageId` 是由 `scripts/build/generate-registry.ts` 扫描目录生成的。`npm run verify:ext` 就是这条承诺的可执行断言：它真的造一门临时语言，然后断言 `src/`（不含 `generated/`）里没有任何代码提到它。

> **私有目录约定**：以 `_` 开头的语言目录默认不参与构建与校验。
> `_template/` 是供复制的脚手架，不该被当成一门真语言渲染出来；
> CI 的临时语言也用这个前缀，这样即便脚本被中断留下残留，也不会让整个仓库的校验失败。
> （这个约定是踩出来的：临时目录曾被 `verify:ext` 留在真实目录树里，导致测试间歇性失败。）

---

## 审阅状态与发布策略

每条内容带 `review.state`（`draft` → `reviewed` → `verified`）与 `review.provenance`。

发布策略在 `content/registry.yaml` 里切换：

| 策略 | 行为 |
| --- | --- |
| `include-draft-with-badge`（**当前**） | draft 参与构建与索引，但页面上必须显示「未经人工校对」 |
| `reviewed-only` | 严格模式：draft 会**阻断构建** |

**当前是 `include-draft-with-badge`**：「基础语法」的 8 章 144 条实现已于 2026-10-01 完成首轮校对（JS/Python 标 `reviewed`），但 Java / Rust / Go 的实现以及三轴重构新增的骨架内容由 AI 生成且**本机没有这些语言的工具链**，无法逐条实跑验证 —— 因此全部标为 `draft`，让页面上的标记如实承载这个事实。能实跑验证后再切回 `reviewed-only`。

> 首轮校对不是走形式：**7 条 LLM 产出里查出 1 处断言完全写反**（原称 Python 的 `json.loads`
> 会丢大整数精度 —— 实测恰恰相反，Python 的 `int` 是任意精度，丢精度的是 JS 的 `JSON.parse`），
> 另有 3 处注释与实际不符。校对方法是**把每条断言的代码真的跑一遍**，而不是重读一遍。
> 注意 `provenance.origin` 仍诚实标为 `llm` —— 校对改的是 `review.state`，不篡改来源。

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

两个变量都带 `PC_` 前缀，避免与宿主环境里同名的通用变量冲突（实测踩到：环境里已存在一个无关的 `BASE_PATH`，静默污染了构建）。

构建链里有两个「不做就一定出事」的步骤，都已经写进 `npm run build`：

1. `dirStyle: 'nested'`（vite.config.ts）—— 产出 `/compare/basics/01-variables/index.html`。默认的 `flat` 会产出 `.html` 后缀文件，而 GitHub Pages 不做「无扩展名 → .html」的解析，结果就是**只有首页能打开**。
2. `dist/404.html`（scripts/build/finalize-dist.ts）—— GitHub Pages 没有 rewrite，深链直接命中 404 时必须回落到 SPA。

构建最后还会**验收**：逐条路由检查 HTML 里是否真的含该页内容文本。空壳预渲染会在这里失败，而不是滑到线上。

---

## 排障

### `npm install` 后构建报 esbuild / rollup 找不到原生二进制

npm 有一个已知 bug（[#4828](https://github.com/npm/cli/issues/4828)）：当 `node_modules` 与 lock 文件状态不一致时，会**静默跳过**平台专用的可选依赖。症状：

- `require('esbuild')` → `The package "@esbuild/win32-x64" could not be found`
- `rollup` → `Cannot find module @rollup/rollup-win32-x64-msvc`

这两个包已显式写进 `package.json` 的 `optionalDependencies`（自带 `os` / `cpu` 限制，在其他平台上 npm 会自动跳过、不报错），正常情况下不会再复发。若仍遇到：

```bash
rm -rf node_modules package-lock.json && npm install
```

> 这个坑值得单列，是因为它的**失败信息与真实原因完全无关** —— 拿到的是 esbuild 在抱怨二进制缺失，
> 而不是「你的 lock 文件坏了」。而且它在一次普通 `npm install minisearch` 之后就复发了（输出里那句
> 不起眼的 `removed 2 packages`）。只补装而不写进 `package.json`，下次安装还会掉。

## SEO（硬需求）

纯 CSR 对不执行 JS 的爬虫等价于空页面，所以这里用 `vite-ssg` 在构建期对**每条路由**渲染出含真实内容的静态 HTML，CSR 只作为交互层。

- 路由清单与页面标题都来自 `src/generated/manifest.json` —— 预渲染与 `sitemap.xml` **共用同一份来源**，不可能出现「sitemap 里有但没预渲染」。
- 客户端导航时由 `usePageMeta` 更新同样的文案，保证用户看到与爬虫看到的一致。
- `index.html` 里预留了 CSP（当前是注释）。启用前请确认没有内联脚本被拦，并把 `script-src` 收紧到实际需要的形式；meta CSP 不支持 `frame-ancestors`。

---

## 目录结构

```
content/                  # 【唯一人工编辑入口】
  registry.yaml           #   语言启用开关 + 基准/对比语言默认值 + 发布策略 + topics 三轴声明
  topics/<topicId>/       #   章节（NN-*.yaml）+ 对级列表资源（pitfalls/glossary/roadmap.yaml）
  concepts/concepts.yaml  #   心智模型对照表（与基准无关，全局一份）
  languages/<id>/         #   语言覆盖层
    meta.yaml             #   语言元信息（注释符驱动 @note 解析、shikiLang 驱动高亮、baseline 候选资格）
    snippets/<NN>-*.yaml  #   按章拆分的实现（一章一文件）
  languages/_template/    #   新增语言时复制的脚手架（`_` 前缀 = 私有目录）
  i18n/zh-CN.yaml         #   界面文案（内容本身不做多语言）
scripts/
  pipeline/               #   validate / build / report / search-index
  build/                  #   注册表生成、预渲染后处理
  lib/                    #   装载、@note 抽取、Markdown + Shiki 渲染、分析、环境变量
src/
  generated/              #   【构建产物，禁止手改】
    content/<topicId>/<chapter>.json   # 内容分片：一章一个文件
    static/concepts.json               # 全局静态资源
    static/<基准>--<目标>.json          # 对级：陷阱 / 词典 / 路线
    search-index/<基准>.json            # 搜索倒排索引，按基准分片
  schemas/                #   内容契约（Zod，唯一真源）
  content/                #   ContentRepository + 行级 diff + 搜索（分词 / 装载 / 查询）
  composables/            #   i18n / pageMeta / 持久化 / 基准切换回落 / 可见列裁剪
  components/             #   compare / code / content / ui
  views/                  #   路由视图
  styles/                 #   tokens（明暗 × 密度）+ base
tests/                    #   单元 + 内容契约测试
```

**内容分片粒度是一章一个文件**（`src/generated/content/<topicId>/<chapter>.json`）。
按 topic 分片在 8 章 72 个 Feature 的量级下会涨到 732 KB，首屏要下载整章 8 倍的数据；
改成按章后单章约 100 KB（gzip 后 8–11 KB），也贴合真实访问模式：用户几乎总是访问某一章。

---

## 搜索（P4 落地）

在构建期生成倒排索引（`scripts/pipeline/search-index.ts`），客户端**进 `/search` 才下载**、不进主包。覆盖五类内容：对照特性、迁移陷阱、术语、心智模型、路线阶段。

**中文是这里唯一的真问题。** MiniSearch 基于空格分词，而中文没有空格 —— 直接用会**静默失效**：索引建得出来、查询也跑得动，就是搜不到。

第一反应是 `Intl.Segmenter`，但实测它在中文上不可靠：

```
'数组与列表'   → ['数','组','与','列表']      ← 「数组」这个整体直接丢了
'空数组是真值' → ['空','数','组','是','真','值']
```

所以中文走 **bigram**：每个字单独出一个 token，再把相邻两字组成二元组 —— 任意两字词组都必然出现在索引里，既不需要词典也没有切分歧义。查询侧配 `combineWith: 'AND'`，否则搜「数组」会把所有含「数」的条目（函数、数值…）都捞出来。

拉丁词与代码符号按原样保留（`?.`、`??=` 是真实的检索需求）。分词实现在 `src/content/search-tokenize.ts`，**构建期与客户端共用同一份** —— 两边分叉会导致同一个静默失败。

**索引按基准分片**（`src/generated/search-index/<基准>.json`）。内容按基准拆成三套后，同一个概念会有三条文档；不分片的话一次要下载三倍，还会在结果里出现三条近似项。查询侧再用 `queryOptions(基准)` 的 `filter` 兜一层 —— MiniSearch 的 `loadJSON` 不记住 options，必须显式传。与基准无关的内容（心智模型对照表）用空 `baseline` 标记，每个分片都收。

预算在 `04-build.ts` 里是**单分片** 90 KB(gzip)：比内容分片的 60 KB 宽，因为它只在 `/search` 按需下载、不进首屏。超线会打印优化路径。

> 当前 `javascript` 分片 118 KB(gz)，**超出红线**（这是拆片前就有的遗留）。下一步按既定路径把索引 `text` 里的 `@note` 文本降级为 summary-only。

## 已知边界（首期不做）

在线运行代码（只留 `Runner` 接口）、内容多语言、账号与云同步、行虚拟化（用 `content-visibility` + CSS 裁剪替代）。

## 许可

本站代码与 `origin: manual` 的原创内容采用 **MIT**。引入的外部内容按各自许可处理，见 `/attributions` 页面与 `content/topics/` 里的 `provenance` 字段。
