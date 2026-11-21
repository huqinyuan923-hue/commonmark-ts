// 模糊测试：随机字符流 5,000 条（含畸形嵌套/未闭合）。
// 验收口径：不崩、输出确定性；与参考实现的差分另在 differential 中统计。
import { describe, expect, it } from 'vitest';
import { renderHtml } from '../src/index.js';
import { fuzzCorpus } from './corpus.js';

describe('模糊测试（种子 20241121，5,000 条）', () => {
  const corpus = fuzzCorpus(5000, 20241121, 120);

  it('语料规模', () => {
    expect(corpus.length).toBe(5000);
  });

  it('不崩且输出确定（渲染两次逐字符相等）', () => {
    for (let i = 0; i < corpus.length; i++) {
      const md = corpus[i]!;
      let a: string;
      let b: string;
      try {
        a = renderHtml(md);
        b = renderHtml(md);
      } catch (e) {
        throw new Error(`#${i} 抛错: ${(e as Error).message}\n输入: ${JSON.stringify(md)}`);
      }
      if (a !== b) {
        throw new Error(
          `#${i} 非确定\n输入: ${JSON.stringify(md)}\n第一次: ${JSON.stringify(a)}\n第二次: ${JSON.stringify(b)}`,
        );
      }
    }
  });
});
