// AST round-trip：md → AST → Markdown 打印 → 再解析 → AST 相等。
// 归一化口径：相邻 text 节点合并后比较（实体/转义手段会拆分 text 节点，语义等价）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHtml, printMarkdown, normalizeAst } from '../src/index.js';
import { parseInternal } from '../src/pipeline.js';

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/spec-examples.json'), 'utf8'),
) as { examples: Array<{ n: number; md: string }> };

describe('AST round-trip（全部 652 例）', () => {
  for (const ex of fixture.examples) {
    it(`#${ex.n}`, () => {
      const ast1 = parseInternal(ex.md);
      const printed = printMarkdown(ast1);
      const ast2 = parseInternal(printed);
      const ok = eq(normalizeAst(ast1), normalizeAst(ast2));
      if (!ok) {
        throw new Error(
          `round-trip 不等\n原文: ${JSON.stringify(ex.md)}\n打印: ${JSON.stringify(printed)}`,
        );
      }
      expect(ok).toBe(true);
    });
  }
});

function eq(a: ReturnType<typeof normalizeAst>, b: ReturnType<typeof normalizeAst>): boolean {
  if (a.type !== b.type) return false;
  if ((a.literal ?? null) !== (b.literal ?? null)) return false;
  if (a.type === 'heading' && a.level !== b.level) return false;
  if (a.type === 'code_block' && ((a.info ?? null) !== (b.info ?? null) || a.isFenced !== b.isFenced)) {
    return false;
  }
  if ((a.type === 'link' || a.type === 'image') && ((a.destination ?? null) !== (b.destination ?? null) || (a.title ?? null) !== (b.title ?? null))) {
    return false;
  }
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!eq(a.children[i]!, b.children[i]!)) return false;
  }
  return true;
}
