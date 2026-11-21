// round-trip 差异查看器（调试工具）：打印失败样例的 原文/打印稿/两边 AST 差异点
// 构建：npx esbuild scripts/rt-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/rt-check.cjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { printMarkdown, normalizeAst } from '../src/index.js';
import { parseInternal } from '../src/pipeline.js';

const fixturePath = resolve(process.cwd(), 'tests/fixtures/spec-examples.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  examples: Array<{ n: number; md: string }>;
};
const maxShow = process.argv[2] ? parseInt(process.argv[2], 10) : 10;

let pass = 0;
const fails: Array<{ n: number; md: string; printed: string; msg: string }> = [];
for (const ex of fixture.examples) {
  try {
    const ast1 = parseInternal(ex.md);
    const printed = printMarkdown(ast1);
    const ast2 = parseInternal(printed);
    const msg = firstDiff(normalizeAst(ast1), normalizeAst(ast2));
    if (msg === null) pass++;
    else fails.push({ n: ex.n, md: ex.md, printed, msg });
  } catch (e) {
    fails.push({ n: ex.n, md: ex.md, printed: '(抛错)', msg: (e as Error).message });
  }
}
console.log(`round-trip 通过 ${pass}/652，失败 ${fails.length}`);
for (const f of fails.slice(0, maxShow)) {
  console.log('──── #' + f.n, '─'.repeat(50));
  console.log('原文    :', JSON.stringify(f.md));
  console.log('打印    :', JSON.stringify(f.printed));
  console.log('差异    :', f.msg);
}

/** 返回第一个差异点的描述；相等返回 null */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  const A = a as {
    type: string;
    literal: string | null;
    level: number;
    info: string | null;
    isFenced: boolean;
    destination: string | null;
    title: string | null;
    children: unknown[];
  };
  const B = b as typeof A;
  if (A.type !== B.type) return `${path}: type ${A.type} ≠ ${B.type}`;
  if ((A.literal ?? null) !== (B.literal ?? null)) {
    return `${path}(${A.type}): literal ${JSON.stringify(A.literal)} ≠ ${JSON.stringify(B.literal)}`;
  }
  if (A.type === 'heading' && A.level !== B.level) return `${path}: level ${A.level} ≠ ${B.level}`;
  if (A.type === 'code_block' && ((A.info ?? null) !== (B.info ?? null) || A.isFenced !== B.isFenced)) {
    return `${path}: info/fenced ${JSON.stringify(A.info)}/${A.isFenced} ≠ ${JSON.stringify(B.info)}/${B.isFenced}`;
  }
  if ((A.type === 'link' || A.type === 'image') && ((A.destination ?? null) !== (B.destination ?? null) || (A.title ?? null) !== (B.title ?? null))) {
    return `${path}: dest/title ${JSON.stringify(A.destination)}/${JSON.stringify(A.title)} ≠ ${JSON.stringify(B.destination)}/${JSON.stringify(B.title)}`;
  }
  if (A.children.length !== B.children.length) {
    return `${path}(${A.type}): children ${A.children.length} ≠ ${B.children.length}`;
  }
  for (let i = 0; i < A.children.length; i++) {
    const r = firstDiff(A.children[i], B.children[i], `${path}/${i}`);
    if (r !== null) return r;
  }
  return null;
}
