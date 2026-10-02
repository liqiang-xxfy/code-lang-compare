# 新语言脚手架

复制本目录即可新增一门语言：

```bash
cp -r content/languages/_template content/languages/<新语言 id>
```

以 `_` 开头的目录是**私有目录**，默认不参与构建与校验 ——
所以本模板不会被当成一门真语言渲染出来。复制后请去掉下划线。

## 1. 填 `meta.yaml`

- `id` **必须等于目录名**（R8 会校验）
- `comment.line` 驱动 `@note` 标记的解析，**写错会导致注记静默丢失**
- `shikiLang` 决定代码高亮；没有独立语法包时可近似（如 ArkTS 用 `typescript`）
- `baseline: true` 表示这门语言可当基准候选（详见 `docs/内容书写标准.md` §6）

## 2. 建实现目录

覆盖层按 **topic 分目录**，文件名只表达「第几章」：

```
snippets/
  basics-javascript/01-variables.yaml     ← 该语言对 basics-javascript 第 1 章的实现
  js2python/01-functions.yaml
```

文件顶层是**对象**（不是裸数组）：

```yaml
topic: basics-javascript          # 必须与目录名、与每条 featureId 前缀一致（R15）
review:                           # 文件级默认，条目可各自覆盖
  state: draft
  provenance:
    origin: llm
    model: <模型名>
    promptTemplateId: <模板 id>
    generatedAt: '2026-01-01'
snippets:
  - featureId: basics-javascript/var-declaration
    equivalence: divergent        # identical | analogous | divergent | absent
    code: |
      // 实现代码；@note 标一般差异，@note! 标高危陷阱
```

单个 feature 需要「错误写法 / 正确写法」这类对照时，把 `code` 换成 `blocks`
（每段必须有 `label`）：

```yaml
    blocks:
      - label: 会出错的写法
        code: |
          ...
      - label: 正确写法
        code: |
          ...
```

## 3. 登记与验证

1. 在 `content/registry.yaml` 的 `languages` 段登记并 `enabled: true`
2. `npm run content:build` —— 缺哪一格 R2 会明确列出来
3. `npm run verify:ext` —— 断言「加语言只加数据」这条承诺仍然成立

> 完整标准见 [docs/内容书写标准.md](../../../docs/内容书写标准.md)。
