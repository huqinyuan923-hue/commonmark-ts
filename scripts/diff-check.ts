// 差异查看器：跑 652 例，打印失败样例的 md / 期望 / 实际（调试工具，不属于测试）
// 用法：node .tmp/diff-check.cjs [单例号] [最多显示数]
// 构建：npx esbuild scripts/diff-check.ts --bundle --platform=node --format=cjs --outfile=.tmp/diff-check.cjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHtml } from '../src/index.js';

// 从项目根（CWD）解析 fixture 路径，不做任何动态路径拼接
const fixturePath = resolve(process.cwd(), 'tests/fixtures/spec-examples.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  _meta: { examples: number };
  examples: Array<{ n: number; section: string; title: string; md: string; html: string }>;
};
const only = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const maxShow = process.argv[3] ? parseInt(process.argv[3], 10) : 12;

let pass = 0;
const fails: Array<{ n: number; md: string; want: string; got: string }> = [];
for (const ex of fixture.examples) {
  let got: string;
  try {
    got = renderHtml(ex.md);
  } catch (e) {
    got = 'THROW: ' + (e as Error).message;
  }
  if (got === ex.html) pass++;
  else fails.push({ n: ex.n, md: ex.md, want: ex.html, got });
}
console.log(`通过 ${pass}/${fixture.examples.length}，失败 ${fails.length}`);
for (const f of fails.slice(0, maxShow)) {
  if (only !== null && f.n !== only) continue;
  console.log('──── #' + f.n, '─'.repeat(50));
  console.log('md  :', JSON.stringify(f.md));
  console.log('want:', JSON.stringify(f.want));
  console.log('got :', JSON.stringify(f.got));
}
if (only !== null && !fails.some((f) => f.n === only) && only <= fixture.examples.length) {
  console.log(`#${only} 通过`);
}
