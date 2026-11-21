// 三角差分：652 规范用例 + fuzz 语料，与 devDependency 参考实现对拍。
// oracle 只当裁判，绝不进运行时（仅本测试引用）。
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHtml } from '../src/index.js';
import { fuzzCorpus } from './corpus.js';

const require_ = createRequire(import.meta.url);
const commonmark = require_('commonmark') as {
  Parser: new (opts?: { smart?: boolean }) => { parse: (s: string) => unknown };
  HtmlRenderer: new (opts?: { smart?: boolean }) => { render: (d: unknown) => string };
};

const parser = new commonmark.Parser();
const renderer = new commonmark.HtmlRenderer();
function oracleHtml(md: string): string {
  return renderer.render(parser.parse(md));
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/spec-examples.json'), 'utf8'),
) as { examples: Array<{ n: number; md: string; html: string }> };

describe('与参考实现（commonmark 0.31.2）差分', () => {
  it('652 规范用例逐例一致', () => {
    const diffs: string[] = [];
    for (const ex of fixture.examples) {
      if (renderHtml(ex.md) !== oracleHtml(ex.md)) {
        diffs.push('#' + ex.n);
      }
    }
    expect(diffs, '不一致用例: ' + diffs.join(', ')).toEqual([]);
  });

  it('fuzz 语料 5,000 条一致', () => {
    const corpus = fuzzCorpus(5000, 20241121, 120);
    const bad: Array<{ i: number; md: string; mine: string; ref: string }> = [];
    for (let i = 0; i < corpus.length; i++) {
      const md = corpus[i]!;
      let mine: string;
      let ref: string;
      try {
        mine = renderHtml(md);
      } catch (e) {
        bad.push({ i, md, mine: 'THROW: ' + (e as Error).message, ref: '' });
        continue;
      }
      try {
        ref = oracleHtml(md);
      } catch (e) {
        // oracle 自身崩溃的语料不计入差分（记录在 REPORT）
        continue;
      }
      if (mine !== ref) {
        bad.push({ i, md, mine, ref });
      }
    }
    if (bad.length > 0) {
      const show = bad
        .slice(0, 5)
        .map(
          (b) =>
            `#${b.i} ${JSON.stringify(b.md)}\n  mine: ${JSON.stringify(b.mine)}\n  ref : ${JSON.stringify(b.ref)}`,
        )
        .join('\n');
      throw new Error(`差分 ${bad.length} 条（前 5 条）:\n${show}`);
    }
    expect(bad.length).toBe(0);
  });

  it('smart 标点选项抽样一致', () => {
    const samples = [
      '"quoted" text',
      "it's a test --- really -- yes... done",
      'a "b c" "d e" f',
      "'single' --dash-- ...dots",
      'He said "hi" to me --- twice...',
    ];
    for (const s of samples) {
      const parserSmart = new commonmark.Parser({ smart: true });
      const rendererSmart = new commonmark.HtmlRenderer({ smart: true });
      const ref = rendererSmart.render(parserSmart.parse(s));
      expect(renderHtml(s, { smart: true }), JSON.stringify(s)).toBe(ref);
    }
  });
});
