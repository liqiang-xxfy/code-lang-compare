# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目是什么

多语言并排对比学习工具：以 JavaScript 为基准语言，把 7 门语言（JS / Python / TS / ArkTS / Kotlin / Swift / Dart，当前启用 JS、Python、Java、Rust、Go 五门）的同一概念并排放置，突出差异。Vue 3 + Vite + TS，纯静态 SSG，无后端。

完整设计文档在 [docs/项目架构设计-定稿.md](docs/项目架构设计-定稿.md)（§15 记录了实现期推翻设计假设的地方，改架构前先读它）。README 里的"三条核心设计"是理解本仓库的最短路径。

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
npm run build            # content:build + vite-ssg build + finalize-dist（含预渲染验收）
npm run registry         # 单独重新生成 src/generated/registry.gen.ts
```

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

### 2. 双轴内容模型，按 featureId 合并

- `content/topics/<topic>/NN-*.yaml` —— 语言无关的轴：定义 `Chapter`（含内联 `features`）
- `content/languages/<id>/snippets/NN-*.yaml` —— 语言覆盖层：每章一个文件，按 `featureId` 挂到 feature 上
- loader 同时支持 `snippets.yaml`（单文件）与 `snippets/*.yaml`（按章拆分），两者会被合并

**加一个 feature**：topics 里加一条 → 每门**已启用**语言各加一条同 `featureId` 的实现（R2 覆盖率是 error 级，缺一格就阻断）。

**加一门语言**（不需要改任何组件/类型/路由）：
1. `cp -r content/languages/_template content/languages/<id>`，`meta.id` 必须等于目录名
2. 在 `content/registry.yaml` 登记并 `enabled: true`
3. `npm run content:build && npm run verify:ext`

`LanguageId` 类型由 [scripts/build/generate-registry.ts](scripts/build/generate-registry.ts) 扫描目录生成；[scripts/verify-extensibility.ts](scripts/verify-extensibility.ts) 是"零代码改动"这句承诺的可执行断言。

### 3. 契约与校验

- **类型唯一真源**：[src/schemas/index.ts](src/schemas/index.ts)（Zod）。`src/types/index.ts` 只做 `z.infer` 再导出，禁止手写 interface。`src/` 侧只 `import type`，校验代码不进客户端包。
- **校验规则 R1–R10** 全部在 [scripts/lib/analyze.ts](scripts/lib/analyze.ts)（R1 结构 / R2 覆盖率 / R3 provenance / R4·R9 @note / R5 引用完整性 / R6 发布门槛 / R7 URL 白名单 / R8 命名 / R10 许可台账）。
- **validate 与 build 共用同一份 `analyzeContent()`**。改校验逻辑只需改这一处，但要注意：脚本被改坏时测试未必发现，`tests/pipeline/content-contract.test.ts` 对**真实 content 目录**断言不变量，是第二道闸门。

### 4. 内容里的两个约定

**`@note` 内联标记**：差异说明写在代码注释里，不用行号锚定（行号会随编辑静默漂移）。标记必须出现在该语言自己的行注释前缀（`meta.comment.line`，如 `//` / `#`）之后，位置不限：

```python
count = 0            # @note 赋值即声明，没有 let / const
MAX_RETRY = 3        # @note! 全大写只是约定，解释器不会阻止你重新赋值
```

`@note!` 为高危语气。构建期抽取成结构化 `notes` 并从展示文本剥离；标记前缀写错会被 R4/R9 拦住。

**`equivalence` 四态**是"是否与基准不同"的唯一判据，不提供相似度百分比（跨语言 diff 恒在低区间，是伪精度）：

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
- **diff 刻意留在运行时**（[src/content/diff.ts](src/content/diff.ts)）：基准语言可切、展示模式会变，预计算是 42 组组合的浪费。用 `diffArrays` 逐行对齐，**不要换回 `diffLines`** —— 它会把相邻删除+新增合并成块，让完全相同的行也被标成"不同"（有回归测试）。
- **内容分片粒度是一章一个文件**（`src/generated/content/<topicId>/<chapter>.json`），由 [src/content/repository.ts](src/content/repository.ts) 用 `import.meta.glob` 懒加载。按 topic 分片会涨到 732 KB，别再改回去。

### 6. SEO 与预渲染

`manifest.routes` 是**可索引路由的单点定义**，vite-ssg 预渲染与 `sitemap.xml` 共用它，因此不可能不一致。`prerenderExtra`（`/search`）预渲染但不进 sitemap。`vite.config.ts` 的 `ssgOptions.dirStyle` **必须是 `nested`**（默认 `flat` 产出 `.html`，GitHub Pages 不做无扩展名解析 → 只有首页能打开）。构建最后一步 [scripts/build/finalize-dist.ts](scripts/build/finalize-dist.ts) 会逐路由验收 HTML 里是否真含该页内容，空壳预渲染在这里失败。

### 7. 搜索的中文分词

MiniSearch 基于空格分词，中文会**静默失效**（索引建得出来、查询也跑得动，就是搜不到）。`Intl.Segmenter` 实测不可靠（`'数组与列表'` → 丢掉「数组」），因此走 **bigram**（unigram + 相邻二元组），查询侧 `combineWith: 'AND'`。[src/content/search-tokenize.ts](src/content/search-tokenize.ts) **构建期与客户端共用同一份** —— 两边分叉会导致同一个静默失败。

## 编辑内容时的硬约束

- 新增内容默认 `review.state: draft`；`registry.publishPolicy` 为 **`include-draft-with-badge`**（当前值）时 draft 可构建但页面必须显示"未经人工校对"；切到 `reviewed-only` 时 draft 直接**阻断构建**（R6）。新增大批量 AI 生成内容时先确认策略。
- `provenance.origin: 'llm'` **刻意不填 `license`** —— 模型输出不产生可署名许可，强填 MIT/GFDL 是错误陈述。合规责任由 `review.state` + 页面标记 + 许可台账承担。台账模板在 [scripts/lib/analyze.ts](scripts/lib/analyze.ts) 的 `LEDGER_TEMPLATE`，只登记实际被使用的来源。
- 以 `_` 开头的语言目录是**私有目录**，默认不参与构建与校验（`_template/`、`verify:ext` 的 `_fixturelang`）。新增真语言不要用下划线前缀。
- YAML 块标量（`code: |`）内部是代码原文，批量给标量加引号的脚本会误伤它们。
- 所有外部 URL 必须是 `https`（R7）。

## 环境陷阱

- **`PC_BASE_PATH` 不带前导斜杠**：Git Bash / MSYS 会把以 `/` 开头的环境变量改写成 Windows 绝对路径，导致 Vite 报 `"base" option should start with a slash`。解析逻辑与提示在 [scripts/lib/env-paths.ts](scripts/lib/env-paths.ts)。不配 `PC_SITE_URL` 就不生成 sitemap（刻意的，错误的 `loc` 会污染索引）。
- **esbuild / rollup 原生二进制丢失**：npm 已知 bug（[#4828](https://github.com/npm/cli/issues/4828)）会静默跳过平台专用可选依赖，报错信息与真实原因完全无关。两个包已写进 `package.json` 的 `optionalDependencies`；仍复发则 `rm -rf node_modules package-lock.json && npm install`。
- 仓库未接入 git（当前不是 git repo），`dist/`、`node_modules/` 见 `.gitignore`。
