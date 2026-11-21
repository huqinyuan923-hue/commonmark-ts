// 从 commonmark-spec 0.31.2 的 spec.txt 提取全部 652 个 example（markdown/html 互补对）。
// 数据来源：node_modules/commonmark-spec/spec.txt（规范文本 CC-BY-SA 4.0 © John MacFarlane，本文
// 件为派生测试夹具，附来源与许可声明）。围栏为 32 个反引号（任务书猜 14，按实际长度自适应提取）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const specPath = new URL('../node_modules/commonmark-spec/spec.txt', import.meta.url);
const outPath = new URL('../tests/fixtures/spec-examples.json', import.meta.url);

const spec = readFileSync(specPath, 'utf8').replace(/\r\n/g, '\n');
const lines = spec.split('\n');

const examples = [];
let i = 0;
let section = '';
// 记录当前章节标题（用于报告分类）；章节行形如 "## 4.1 ..." / "### 4.1.1 ..."
for (; i < lines.length; i++) {
  const secMatch = lines[i].match(/^#{2,3} (\d+(?:\.\d+)*)\.?\s+(.*)$/);
  if (secMatch) section = `${secMatch[1]} ${secMatch[2].trim()}`;

  const m = lines[i].match(/^(`+) example(?:\s+(.*))?$/);
  if (!m) continue;
  const fence = m[1];
  const L = fence.length;
  const title = (m[2] ?? '').trim();

  // 扫到等长围栏收口
  let j = i + 1;
  while (j < lines.length && !new RegExp('^`{' + L + '}\\s*$').test(lines[j])) j++;
  if (j >= lines.length) throw new Error(`第 ${i + 1} 行 example 未闭合：${lines[i]}`);

  const body = lines.slice(i + 1, j);
  // 第一个 "." 行把 markdown 与期望 html 分开
  const dot = body.findIndex((l) => l === '.');
  if (dot < 0) throw new Error(`example（第 ${i + 1} 行起）缺 "." 分隔行`);
  // 规范前言约定：示例中的真实制表符以 → (U+2192) 展示，提取时还原为 \t
  const unarrow = (s) => s.replace(/\u2192/g, '\t');
  const md = unarrow(body.slice(0, dot).join('\n') + (dot > 0 ? '\n' : ''));
  const html = unarrow(body.slice(dot + 1).join('\n') + (body.length - dot - 1 > 0 ? '\n' : ''));

  examples.push({ n: examples.length + 1, section, title, md, html });
  i = j;
}

// —— oracle 自检：期望 html 与参考实现渲染结果逐字符对拍，验证提取口径 ——
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const commonmark = require_('commonmark');
const parser = new commonmark.Parser();
const renderer = new commonmark.HtmlRenderer();
let pass = 0;
const fails = [];
for (const ex of examples) {
  let got;
  try {
    got = renderer.render(parser.parse(ex.md));
  } catch (e) {
    fails.push(`#${ex.n} 渲染抛错: ${e.message}`);
    continue;
  }
  if (got === ex.html) pass++;
  else fails.push(`#${ex.n} 提取口径不符`);
}

mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
const out = {
  _meta: {
    source: 'commonmark-spec 0.31.2 spec.txt (CC-BY-SA-4.0, (c) John MacFarlane)',
    extractedBy: 'scripts/gen-spec-examples.mjs',
    examples: examples.length,
    oracleSelfCheck: `${pass}/${examples.length} 通过（提取口径与参考实现逐字符一致）`,
  },
  examples,
};
writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');

console.log(`提取 ${examples.length} 例 → ${outPath.pathname}`);
console.log(`oracle 自检: ${pass}/${examples.length}`);
if (fails.length) console.log('不符样例:\n' + fails.slice(0, 10).join('\n'));
