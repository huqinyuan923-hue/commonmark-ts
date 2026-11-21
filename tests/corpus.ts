// 共享 fuzz 语料：固定种子的可复现随机字符串（fuzz 测试与差分测试共用同一语料）
export function makeRng(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    return (x >>> 0) / 4294967296;
  };
}

// CommonMark 高价值字符池：结构字符 + 畸形组合源 + 少量文本与 Unicode
const POOL =
  '`*_[]()<>!&\\#-+=~:;"\'.\t\n abcXYZ0123\r' +
  '\u00a0\u2019\u2260\u20ac\u201c\u201d\u300c\u300d\u0000\u000b\u000c\ufffd';

export function fuzzCorpus(count: number, seed: number, maxLen: number): string[] {
  const rng = makeRng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = 1 + Math.floor(rng() * maxLen);
    let s = '';
    for (let j = 0; j < len; j++) {
      s += POOL.charAt(Math.floor(rng() * POOL.length));
    }
    out.push(s);
  }
  return out;
}
