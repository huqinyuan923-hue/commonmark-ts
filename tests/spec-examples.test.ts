// 官方 652 例逐例对拍：本项目定义性验收。
// fixture 由 scripts/gen-spec-examples.mjs 生成（oracle 自检 652/652 的提取口径）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderHtml } from '../src/index.js';

interface SpecExample {
  n: number;
  section: string;
  title: string;
  md: string;
  html: string;
}

const fixturePath = new URL('./fixtures/spec-examples.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  _meta: { examples: number };
  examples: SpecExample[];
};

describe('官方 CommonMark 0.31.2 规范用例', () => {
  it('fixture 完整性：应为 652 例', () => {
    expect(fixture.examples.length).toBe(652);
  });

  for (const ex of fixture.examples) {
    it(`#${ex.n} ${ex.section}${ex.title ? ' · ' + ex.title : ''}`, () => {
      expect(renderHtml(ex.md)).toBe(ex.html);
    });
  }
});
