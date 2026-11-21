// 公开 API：parseBlocks / parseInlines / renderHtml（任务书规定的三个入口）。
// 内部 MdNode 在导出边界收敛为任务书规定的 { type, children?, literal?, attrs? } 形状。
import { MdNode, astEquals, printAst } from './ast.js';
import { BlockParser } from './blocks.js';
import { InlineParser } from './inlines.js';
import { renderHtml as renderHtmlInternal, RenderOptions } from './render-html.js';

export interface Node {
  type: string;
  children?: Node[];
  literal?: string;
  attrs?: Record<string, string>;
}

export { astEquals, printAst };

/** 内部节点 → 公开 Node（attrs 承载结构化元数据） */
function toPublic(node: MdNode): Node {
  const out: Node = { type: node.type };
  const attrs: Record<string, string> = {};
  let hasAttrs = false;
  const put = (k: string, v: string | number | boolean | undefined | null): void => {
    if (v !== undefined && v !== null && v !== '') {
      attrs[k] = String(v);
      hasAttrs = true;
    }
  };
  switch (node.type) {
    case 'heading':
      put('level', node.level);
      break;
    case 'code_block':
      put('info', node.info ?? '');
      put('fenced', node.isFenced ? 'true' : '');
      break;
    case 'list': {
      const d = node.listData!;
      put('type', d.type);
      put('tight', d.tight ? 'true' : 'false');
      put('start', d.start);
      put('delim', d.delim);
      put('marker', d.bulletChar);
      break;
    }
    case 'link':
      put('href', node.destination ?? '');
      put('title', node.title ?? '');
      break;
    case 'image':
      put('src', node.destination ?? '');
      put('title', node.title ?? '');
      break;
    default:
      break;
  }
  if (hasAttrs) out.attrs = attrs;
  if (node.literal !== null) {
    out.literal = node.literal;
  } else if (node.type === 'paragraph' || node.type === 'heading') {
    // parseBlocks 输出：段落/标题的原文内容进 literal（未经内联解析）
    out.literal = node.stringContent;
  }
  if (node.children.length > 0) out.children = node.children.map(toPublic);
  return out;
}

/**
 * 仅块级解析：返回 document AST。
 * 段落/标题的内容不解析内联，保留在 literal（段落为原文、标题为剥离后的原文、
 * 围栏/缩进代码块与 HTML 块为字面内容）。
 */
export function parseBlocks(src: string): Node {
  const parser = new BlockParser();
  const doc = parser.parse(src);
  return toPublic(doc);
}

/**
 * 独立内联解析：把 text 当作一段内联内容解析（无链接引用定义可查，
 * 引用链接保持字面文本）。返回 type 为 'inline' 的节点，children 为内联元素序列。
 */
export function parseInlines(text: string): Node {
  const holder = new MdNode('paragraph');
  holder.stringContent = text;
  const parser = new InlineParser();
  parser.parse(holder);
  const out: Node = { type: 'inline', children: holder.children.map(toPublic) };
  return out;
}

export interface RenderHtmlOptions {
  /** smart 标点：引号弯引号化、-- → 短破折号、--- → 长破折号、... → 省略号 */
  smart?: boolean;
  /** 软换行渲染为 <br />（扩展项，默认关闭） */
  softbreakHard?: boolean;
}

/** 完整管线：块级解析 → 链接引用定义 → 内联解析 → HTML 渲染 */
export function renderHtml(src: string, opts: RenderHtmlOptions = {}): string {
  const blockParser = new BlockParser({ smart: opts.smart });
  const doc = blockParser.parse(src);
  blockParser.inlineParser.refmap = blockParser.refmap;
  blockParser.inlineParser.options = { smart: opts.smart ?? false };
  parseTreeInlines(doc, blockParser.inlineParser);
  const renderOpts: RenderOptions = { softbreakHard: opts.softbreakHard };
  return renderHtmlInternal(doc, renderOpts);
}

/** 遍历块树，对段落与标题做内联解析 */
function parseTreeInlines(block: MdNode, inlineParser: InlineParser): void {
  for (const child of block.children) {
    if (child.type === 'paragraph' || child.type === 'heading') {
      inlineParser.parse(child);
    } else if (child.children.length > 0) {
      parseTreeInlines(child, inlineParser);
    }
  }
}
