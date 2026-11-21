// Markdown 序列化器（AST → Markdown，round-trip 用）。
// 策略：文本节点里所有 ASCII 标点一律反斜杠转义；会被结构吞噬的空格/制表符/回车
// 用数字字符引用表示（再解析时还原为文本节点）；强调嵌套时换用另一字符的定界符
// 避免定界符粘连；链接目的地一律 <...> 形式（解析期已 URL 编码，不含 <> 与换行）。
// 仅保证对“可从 CommonMark 解析得到的 AST”可逆；局限记录在 REPORT。
import { MdNode } from './ast.js';

// 可转义的 ASCII 标点集合（与解析器 ESCAPABLE 同集）
const PUNCT: Record<string, boolean> = {};
for (const ch of "!\"#$%&'()*+,./:;<=>?@[\\]^_`{|}~-") {
  PUNCT[ch] = true;
}

/** 文本主体转义：ASCII 标点加反斜杠；换行/回车用实体（裸 \n 会被解析为软换行） */
function escapePunct(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\r') {
      out += '&#13;';
    } else if (ch === '\n') {
      out += '&#10;';
    } else if (PUNCT[ch]) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 边缘位置的空白 → 数字字符引用（行首/括号边缘的空白会被结构或 trim 吞掉；
 * 含 NBSP 等 JS trim 会剥的 Unicode 空白） */
function wsEntity(ch: string): string {
  return '&#' + ch.codePointAt(0)!.toString(10) + ';';
}

const isEdgeWs = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || (ch !== '\n' && ch !== '\r' && /\s/u.test(ch));

interface EdgeCtx {
  lead: boolean; // 本节点渲染位紧邻开括号或行首
  trail: boolean; // 本节点渲染尾紧邻闭括号或块尾
  lineStart: boolean; // 行首（跨行内容的续行首）
}

/** 渲染内联序列；lead/trail 只作用于首/末子节点 */
function renderSeq(
  children: MdNode[],
  lead: boolean,
  trail: boolean,
  lineStart: boolean,
): string {
  let out = '';
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    out += renderInlineOne(children[i]!, {
      lead: lead && i === 0,
      trail: trail && isLast,
      lineStart,
    });
    if (out.length > 0) {
      lineStart = out.endsWith('\n');
    }
  }
  return out;
}

/** 单个内联节点 → 字符串 */
function renderInlineOne(node: MdNode, ctx: EdgeCtx): string {
  switch (node.type) {
    case 'text':
      return renderText(node.literal ?? '', ctx);
    case 'softbreak':
      return '\n';
    case 'linebreak':
      return '\\\n';
    case 'code':
      return renderCodeSpan(node.literal ?? '');
    case 'emph': {
      const inner = renderSeq(node.children, true, ctx.trail, false);
      // 定界符选择：内容边缘与内层强调粘连时会改变解析结构。
      // * + 内层 emph 的 * 粘连成 *** → 会被解析成 emph(strong) ✗ → 换 _；
      // * + 内层 strong 的 ** 粘连成 *** → 恰好解析回 emph(strong) ✓ → 保留 *。
      const firstType = node.children[0]?.type ?? null;
      const lastType = node.children[node.children.length - 1]?.type ?? null;
      const openU = inner.startsWith('*') && firstType === 'emph';
      const closeU = inner.endsWith('*') && lastType === 'emph';
      const d = openU || closeU ? '_' : '*';
      return d + inner + d;
    }
    case 'strong': {
      const inner = renderSeq(node.children, true, ctx.trail, false);
      // ** 默认（词内安全）；内容边缘接触 *（内层 emph）或 _（任何粘连）时换 __，
      // 避免 *** / ___ 粘连改变解析结构；** + 内层 strong 粘连成 **** 恰好正确 → 保留。
      const firstType = node.children[0]?.type ?? null;
      const lastType = node.children[node.children.length - 1]?.type ?? null;
      const openU =
        (inner.startsWith('*') && firstType === 'emph') || inner.startsWith('_');
      const closeU =
        (inner.endsWith('*') && lastType === 'emph') || inner.endsWith('_');
      const d = openU || closeU ? '__' : '**';
      return d + inner + d;
    }
    case 'link':
      return renderLinkLike(node, false);
    case 'image':
      return renderLinkLike(node, true);
    case 'html_inline':
      return node.literal ?? '';
    default:
      return '';
  }
}

/** 文本渲染：边缘空白实体化 + 标点全转义 */
function renderText(lit: string, ctx: EdgeCtx): string {
  let start = 0;
  let end = lit.length;
  let lead = '';
  let trail = '';
  if (ctx.lead) {
    while (start < lit.length && isEdgeWs(lit[start]!)) {
      lead += wsEntity(lit[start]!);
      start++;
    }
  }
  if (ctx.trail) {
    while (end > start && isEdgeWs(lit[end - 1]!)) {
      trail = wsEntity(lit[end - 1]!) + trail;
      end--;
    }
  }
  return lead + escapePunct(lit.slice(start, end)) + trail;
}

/** 代码 span：定长反引号围栏 + 边缘空格规则还原 */
function renderCodeSpan(contents: string): string {
  if (contents === '') return '``';
  const run = maxRun(contents, '`');
  const fence = '`'.repeat(Math.max(1, run + 1));
  if (/^[ ]*$/.test(contents)) {
    return fence + contents + fence; // 全空格内容不会被剥边
  }
  return fence + ' ' + contents + ' ' + fence;
}

/** 链接/图片：[内容](<目的地> "标题") */
function renderLinkLike(node: MdNode, image: boolean): string {
  const inner = renderSeq(node.children, false, false, false);
  const dest = node.destination ?? '';
  const title = escapeTitle(node.title);
  const open = image ? '![' : '[';
  let suffix = '(<' + dest + '>';
  if (title !== '') suffix += ' ' + title;
  suffix += ')';
  return open + inner + ']' + suffix;
}

/** 标题值转义：反斜杠/引号转义，换行用实体 */
function escapeTitle(title: string | null): string {
  if (title === null || title === '') return '';
  let s = '';
  for (const ch of title) {
    if (ch === '\\') s += '\\\\';
    else if (ch === '"') s += '\\"';
    else if (ch === '\n') s += '&#10;';
    else if (PUNCT[ch]) s += '\\' + ch;
    else s += ch;
  }
  return '"' + s + '"';
}

function maxRun(s: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of s) {
    if (c === ch) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

// —— 块级序列化 ——

/** 块 → 行数组；prefix 前缀到本块发出的每一行（引用/列表嵌套用） */
function blockLines(node: MdNode, prefix: string): string[] {
  switch (node.type) {
    case 'paragraph': {
      // 段落首尾都是“边缘”：行首空白与尾随空白都会被吃掉
      const s = renderSeq(node.children, true, true, true);
      return s.split('\n').map((l) => prefix + l);
    }
    case 'heading': {
      const content = renderSeq(node.children, true, true, false);
      // 多行的 h1/h2 只能走 setext 形态；ATX 是单行的
      if ((node.level === 1 || node.level === 2) && content.includes('\n')) {
        const underline = node.level === 1 ? '===' : '---';
        return content.split('\n').map((l) => prefix + l).concat([prefix + underline]);
      }
      const atx = '#'.repeat(node.level) + (content !== '' ? ' ' + content : '');
      return [prefix + atx];
    }
    case 'code_block': {
      const info = node.info ?? '';
      const content = node.literal ?? '';
      if (!node.isFenced) {
        // 缩进代码块：每行加 4 空格缩进（保留 isFenced=false 语义）
        // 在列表项首块位置恰好落在“标记 + 1 空格 + 4 缩进”的规则 #2 缩进上
        return content
          .replace(/\n$/, '')
          .split('\n')
          .map((l) => prefix + '    ' + l);
      }
      const fenceChar = /`/.test(info) ? '~' : '`';
      const fenceLen = Math.max(3, maxRun(content, fenceChar) + 1);
      const lines: string[] = [
        prefix + fenceChar.repeat(fenceLen) + (info !== '' ? ' ' + info : ''),
      ];
      if (content !== '') {
        for (const l of content.replace(/\n$/, '').split('\n')) {
          lines.push(prefix + l);
        }
      }
      lines.push(prefix + fenceChar.repeat(fenceLen));
      return lines;
    }
    case 'html_block':
      return (node.literal ?? '').replace(/\n$/, '').split('\n').map((l) => prefix + l);
    case 'thematic_break':
      return [prefix + '---'];
    case 'block_quote': {
      // 引用内块间恒为空行（可达邻接皆安全；空行在引用内以 > 行表示）
      const inner = joinBlocks(node.children, false);
      if (inner.length === 0) {
        return [prefix + '>']; // 空引用块
      }
      return inner.map((l) => (l === '' ? prefix + '>' : prefix + '> ' + l));
    }
    case 'item': {
      const tight = node.parent?.type === 'list' && (node.parent.listData?.tight ?? true);
      const inner = joinBlocks(node.children, tight);
      const marker = itemMarker(node);
      // 复现原始缩进：markerOffset（标记前缩进）+ padding（标记宽 + 后随空格）
      const data = node.listData;
      const mo = data?.markerOffset ?? 0;
      const pad = data?.padding ?? marker.length + 1;
      const markerStr = ' '.repeat(mo) + marker + ' '.repeat(Math.max(1, pad - marker.length));
      const contIndent = ' '.repeat(mo + pad);
      const lines: string[] = [];
      if (inner.length === 0) {
        lines.push(prefix + ' '.repeat(mo) + marker);
      } else {
        const first = inner[0] ?? '';
        // “标记行整体”若构成主题分隔（如 "- ---"），改两行形态：标记独行 + 内容缩进
        if (isThematicLine((prefix + markerStr + first).replace(/^\s+/, ''))) {
          lines.push(prefix + ' '.repeat(mo) + marker);
          for (const l of inner) {
            lines.push(l === '' ? '' : prefix + contIndent + l);
          }
        } else {
          lines.push(prefix + markerStr + first);
          for (let i = 1; i < inner.length; i++) {
            const l = inner[i]!;
            lines.push(l === '' ? '' : prefix + contIndent + l);
          }
        }
      }
      return lines;
    }
    case 'list': {
      const parts = node.children.map((item) => blockLines(item, prefix));
      const sep = (node.listData?.tight ?? true) ? '\n' : '\n\n';
      const lines: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (i > 0 && sep === '\n\n') lines.push('');
        lines.push(...parts[i]!);
      }
      return lines;
    }
    case 'document':
      return joinBlocks(node.children, false);
    default:
      return [];
  }
}

/** 容器子块拼接：blank=false 时块间只换行（紧列表项内），true 时空行分隔 */
function joinBlocks(children: MdNode[], tight: boolean): string[] {
  const parts = children.map((c) => blockLines(c, ''));
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && !tight) lines.push('');
    lines.push(...parts[i]!);
  }
  return lines;
}

function itemMarker(item: MdNode): string {
  const list = item.parent;
  if (list === null || list.listData === null) return '-';
  const d = list.listData;
  if (d.type === 'bullet') return d.bulletChar ?? '-';
  const start = d.start ?? 1;
  const idx = list.children.indexOf(item);
  return String(start + idx) + (d.delim ?? '.');
}

/** 与解析器一致的主题分隔线判定（用于避免“- ---”被顶层读成分隔线） */
const reThematic = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
function isThematicLine(line: string): boolean {
  return reThematic.test(line);
}

/** AST → Markdown 全文（以单个换行结尾） */
export function printMarkdown(root: MdNode): string {
  const lines = blockLines(root, '');
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
