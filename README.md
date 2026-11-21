# commonmark-ts

从零手写的 CommonMark 0.31.2 解析器（纯 TypeScript，零 npm 运行时依赖），
以**官方 652 个规范用例逐例对拍**为定义性验收——全部通过。

## 用法

```ts
import { renderHtml, parseBlocks, parseInlines } from 'commonmark-ts';

renderHtml('# hi **b**');            // <h1>hi <strong>b</strong></h1>\n
renderHtml('a --- b', { smart: true }); // smart 标点
parseBlocks(src);                     // 块级 AST（段落/标题内容在 literal，未解析内联）
parseInlines(text);                   // 独立内联 AST（type 'inline'）
```

公开 AST 形状：`{ type, children?, literal?, attrs? }`；attrs 承载结构化元数据：
heading 的 `level`、code_block 的 `info`/`fenced`、list 的 `type`/`tight`/`start`/`delim`/`marker`、
link/image 的 `href`/`src`/`title`。

## 测试

```bash
npm test          # 1318 例：652 规范例 + 652 round-trip + fuzz 5000 + 差分 + API
npm run typecheck # strict 全绿
```

- **652 例对拍**：`tests/fixtures/spec-examples.json` 由 `npm run gen:spec` 从
  commonmark-spec 0.31.2 的 spec.txt 提取（32 反引号围栏、`→`=tab 还原、oracle 自检 652/652）。
- **fuzz**：固定种子 5000 条随机流，不崩 + 输出确定性（`tests/corpus.ts`）。
- **三角差分**：与 devDependency `commonmark@0.31.2`（仅测试期裁判）在 652 例 + fuzz 语料上零差分。
- **round-trip**：AST → Markdown（`src/render-md.ts`）→ 再解析 → AST 相等（归一化口径见 REPORT）。

## Web

```bash
npm run build:web # esbuild 单文件 → dist/web/index.html
```

线上：https://commonmark-lab.pages.dev （左编辑右预览 + HTML/AST/重打印检视）。

## 目录

- `src/blocks.ts` 块级解析（行驱动，规范附录 A）
- `src/inlines.ts` 内联解析（delimiter 栈，强调 17 条规则）
- `src/render-html.ts` / `src/render-md.ts` HTML / Markdown 渲染
- `src/entities.ts` HTML5 实体表（生成文件，勿手改）
- 详见 [REPORT.md](REPORT.md)
