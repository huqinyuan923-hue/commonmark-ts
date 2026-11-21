// 内部全解析管线：块级 → 链接引用定义 → 内联。renderHtml 与 round-trip 测试共用。
import { MdNode } from './ast.js';
import { BlockParser } from './blocks.js';
import { InlineParser, InlineOptions } from './inlines.js';

/** 解析为内部 MdNode 树（段落/标题已完成内联解析） */
export function parseInternal(src: string, opts: InlineOptions = {}): MdNode {
  const blockParser = new BlockParser(opts);
  const doc = blockParser.parse(src);
  blockParser.inlineParser.refmap = blockParser.refmap;
  blockParser.inlineParser.options = opts;
  parseTreeInlines(doc, blockParser.inlineParser);
  return doc;
}

/** 遍历块树，对段落与标题做内联解析 */
export function parseTreeInlines(block: MdNode, inlineParser: InlineParser): void {
  for (const child of block.children) {
    if (child.type === 'paragraph' || child.type === 'heading') {
      inlineParser.parse(child);
    } else if (child.children.length > 0) {
      parseTreeInlines(child, inlineParser);
    }
  }
}
