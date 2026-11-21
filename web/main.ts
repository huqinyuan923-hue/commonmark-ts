// Web UI 入口：左编辑右预览，实时渲染；附 HTML / AST / 重打印（round-trip）检视。
import { renderHtml, printMarkdown, printAst, normalizeAst } from '../src/index.js';
import { parseInternal } from '../src/pipeline.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const editor = $('editor') as HTMLTextAreaElement;
const viewDoc = $('view-doc');
const viewHtml = $('view-html');
const viewAst = $('view-ast');
const viewRt = $('view-rt');
const statCount = $('stat-count');
const statParse = $('stat-parse');

const SAMPLE = [
  '# CommonMark Lab',
  '',
  '用 **纯 TypeScript** 从零手写的 CommonMark 0.31 解析器，零运行时依赖。',
  '',
  '## 快速试用',
  '',
  '- 以官方 *652 个规范用例* 逐例对拍，`100%` 通过',
  '- 强调算法：delimiter run + 17 条规则',
  '- 链接 [引用式][ref]、内联式、自动链接 <https://example.com>',
  '',
  '> 引用块里也可以有 **强调** 与 `代码`',
  '> 第二行（惰性续行）',
  '',
  '```ts',
  'function hello(name: string): string {',
  "  return `hi, ${name}`;",
  '}',
  '```',
  '',
  '1. 有序列表',
  '2. 支持松紧判定',
  '',
  '---',
  '',
  '[ref]: https://commonmark.org "CommonMark 官网"',
].join('\n');

let rightTab: 'doc' | 'html' | 'ast' | 'rt' = 'doc';

function refresh(): void {
  const src = editor.value;
  const smart = ($('opt-smart') as HTMLInputElement).checked;
  const hard = ($('opt-hard') as HTMLInputElement).checked;
  let html = '';
  let astStr = '';
  let rtStr = '';
  try {
    html = renderHtml(src, { smart, softbreakHard: hard });
    const doc = parseInternal(src, { smart });
    astStr = printAst(normalizeAst(doc));
    rtStr = printMarkdown(doc);
    statParse.textContent = '解析正常';
    statParse.className = 'ok';
  } catch (e) {
    statParse.textContent = '解析异常: ' + (e as Error).message;
    statParse.className = '';
  }
  viewDoc.innerHTML = html;
  viewHtml.textContent = html;
  viewAst.textContent = astStr || '(空文档)';
  viewRt.textContent = rtStr || '(空文档)';
  statCount.textContent = `${src.length} 字符`;
}

function showRight(which: 'doc' | 'html' | 'ast' | 'rt'): void {
  rightTab = which;
  viewDoc.style.display = which === 'doc' ? '' : 'none';
  viewHtml.style.display = which === 'html' ? '' : 'none';
  viewAst.style.display = which === 'ast' ? '' : 'none';
  viewRt.style.display = which === 'rt' ? '' : 'none';
  for (const b of document.querySelectorAll('#tabs-r button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.v === which);
  }
}

editor.addEventListener('input', refresh);
for (const b of document.querySelectorAll('#tabs-r button')) {
  b.addEventListener('click', () => showRight((b as HTMLElement).dataset.v as 'doc'));
}
$('btn-sample').addEventListener('click', () => {
  editor.value = SAMPLE;
  refresh();
});
$('opt-smart').addEventListener('change', refresh);
$('opt-hard').addEventListener('change', refresh);

editor.value = SAMPLE;
refresh();
