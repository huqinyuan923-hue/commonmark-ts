// 公开 API 单元测试：parseBlocks / parseInlines / renderHtml
import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInlines, renderHtml } from '../src/index.js';

describe('公开 API', () => {
  it('renderHtml 基本管线', () => {
    expect(renderHtml('# hi **b**')).toBe('<h1>hi <strong>b</strong></h1>\n');
  });

  it('renderHtml 软换行默认为换行符', () => {
    expect(renderHtml('a\nb')).toBe('<p>a\nb</p>\n');
  });

  it('renderHtml smart 标点', () => {
    expect(renderHtml('"a"... -- ---')).toBe('<p>&quot;a&quot;... -- ---</p>\n');
    expect(renderHtml('"a"... -- ---', { smart: true })).toBe('<p>\u201Ca\u201D\u2026 \u2013 \u2014</p>\n');
  });

  it('parseBlocks 返回块级 AST，段落内容保留在 literal', () => {
    const doc = parseBlocks('# t\n\npara *x*\n');
    expect(doc.type).toBe('document');
    const h = doc.children![0]!;
    expect(h.type).toBe('heading');
    expect(h.attrs).toEqual({ level: '1' });
    expect(h.literal).toBe('t');
    const p = doc.children![1]!;
    expect(p.type).toBe('paragraph');
    expect(p.literal).toBe('para *x*\n');
  });

  it('parseBlocks 列表松紧元数据进 attrs', () => {
    const loose = parseBlocks('- a\n\n- b\n');
    const list1 = loose.children![0]!;
    expect(list1.type).toBe('list');
    expect(list1.attrs!.tight).toBe('false');
    const tight = parseBlocks('- a\n- b\n');
    const list2 = tight.children![0]!;
    expect(list2.attrs!.tight).toBe('true');
  });

  it('parseInlines 解析强调与代码 span', () => {
    const ast = parseInlines('a *b* `c`');
    expect(ast.type).toBe('inline');
    expect(ast.children!.map((n) => n.type)).toEqual([
      'text',
      'emph',
      'text',
      'code',
    ]);
    expect(ast.children![1]!.children![0]!.literal).toBe('b');
  });

  it('parseInlines 无引用定义时引用链接保持字面', () => {
    const ast = parseInlines('[foo]');
    expect(ast.children![0]!.type).toBe('text');
  });
});
