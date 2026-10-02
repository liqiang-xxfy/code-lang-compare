# 新语言脚手架

复制本目录即可新增一门语言：

```bash
cp -r content/languages/_template content/languages/<新语言 id>
```

以 `_` 开头的目录是**私有目录**，默认不参与构建与校验 ——
所以本模板不会被当成一门真语言渲染出来。复制后请去掉下划线。

> 本文描述 v2 的目录结构。**内容架构迁移（见 [docs/内容架构迁移实施步骤.md](../../../docs/内容架构迁移实施步骤.md)）
> 完成前**，正在运行的管线读的是旧的 `snippets/` 布局；请以那份文档的进度表为准。

## 1. 填 `meta.yaml`

- `id` **必须等于目录名**
- `comment.line` 驱动 `@note` 标记的解析，**写错会导致注记静默丢失**
- `shikiLang` 决定代码高亮；没有独立语法包时可近似（如 ArkTS 用 `typescript`）
- `baseline` 保持 `false` —— 基准固定为 JavaScript / Python / Java 三门

## 2. 建内容目录

**目录即归属**，文件名即章节 id：

```
content/languages/<语言>/
  basics/
    variables.yaml      ← 对应 content/catalog/basics.yaml 的 variables 章
```

语言取祖父目录、板块取父目录、章节取文件名 —— 所以文件里**不重复声明**这三样。

一条知识点 = 一个「对比框」，三个槽位：

| 槽位 | 怎么写 |
| --- | --- |
| ① 代码 | `code`（单段）或 `blocks`（多段对照，每段必须有 `label`），二选一 |
| ② 注释 | 写在代码行内的 `@note` / `@note!`，**不是字段** |
| ③ 说明 | 作**基准列**时用 `baseline`；作**对比列**时用 `vs.<当前基准 id>` |

三槽全空是合法的，但必须 `absent: true` —— 否则与「忘了写」无法区分。

```yaml
review:                        # 文件级默认，某一格可用自己的 review 覆盖
  state: draft
  provenance:
    origin: llm
    model: <模型名>
    promptTemplateId: <模板 id>
    generatedAt: '2026-01-01'

boxes:
  declaration:                 # key 必须与 catalog 里该章的 feature id 一致
    code: |
      // 实现代码；@note 标一般差异，@note! 标高危陷阱
    vs:                        # 对比列：key = 当前基准 id
      javascript: |
        与 JavaScript 相比……
      python: |
        与 Python 相比……
      java: |
        与 Java 相比……
    equivalence:               # 缺 key = identical
      javascript: analogous
      java: divergent

  hoisting:                    # 本语言没有这个概念
    absent: true
    vs:
      javascript: |
        本语言没有变量提升这一概念。
```

基准固定三门，所以新语言**一律是对比列语言**：`vs` 要写全三门，`baseline` 可以省。
（`baseline` 是「本语言作基准列时」的说明，只有三大基准才用得上。）

## 3. 登记与验证

1. 在 `content/registry.yaml` 的 `languages` 段登记并 `enabled: true`
2. `npm run content:build` —— 缺哪一格，校验会明确列出来
3. `npm run verify:ext` —— 断言「加语言只加数据」这条承诺仍然成立

> 完整标准见 [docs/内容书写标准.md](../../../docs/内容书写标准.md)。
