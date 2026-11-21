// 块级解析器：按规范附录 A 的行驱动算法实现。
// 每行先自上而下尝试延续已打开的容器块，再自左而右尝试新的块起始，
// 最后把行内剩余文本交给最深的可接受文本的块。
// Tab 处理：结构判定时按 4 列制表位展开（列数推进），内容里保留原字符。
import { MdNode, ListData, RefEntry } from './ast.js';
import { unescapeString } from './decode.js';
import { InlineParser } from './inlines.js';

const CODE_INDENT = 4;
const C_GREATERTHAN = 62;
const C_LESSTHAN = 60;
const C_OPEN_BRACKET = 91;

// —— HTML 块的七类起始/结束条件（规范 4.6）——
const reHtmlBlockOpen: RegExp[] = [
  /./, // 0 号占位
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  // 类型 7：完整的开标签或闭标签独占一行（标签语法同内联 HTML tag，见 inlines.ts）
  new RegExp(
    '^(?:<[A-Za-z][A-Za-z0-9-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"\'=<>`\\x00-\\x20]+|\'[^\']*\'|"[^"]*"))?)*\\s*/?>|</[A-Za-z][A-Za-z0-9-]*\\s*>)\\s*$',
  ),
];

const reHtmlBlockClose: RegExp[] = [
  /./, // 0 号占位
  /<\/(?:script|pre|textarea|style)>/i,
  /-->/,
  /\?>/,
  />/,
  /\]\]>/
];

const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const reMaybeSpecial = /^[#`~*+_=<>0-9-]/;
const reNonSpace = /[^ \t\f\v\r\n]/;
const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;

const isBlankStr = (s: string): boolean => !reNonSpace.test(s);
const isSpaceOrTab = (c: number): boolean => c === 32 || c === 9;
const peekAt = (ln: string, pos: number): number => (pos < ln.length ? ln.charCodeAt(pos) : -1);

// continueBlock 返回值：0 = 匹配延续；1 = 不匹配（应关闭）；2 = 行已处理完（围栏闭合）
type ContinueResult = 0 | 1 | 2;

export class BlockParser {
  doc: MdNode = new MdNode('document');
  tip: MdNode = this.doc;
  oldtip: MdNode = this.doc;
  lastMatchedContainer: MdNode = this.doc;
  currentLine = '';
  lineNumber = 0;
  lastLineLength = 0;
  offset = 0;
  column = 0;
  nextNonspace = 0;
  nextNonspaceColumn = 0;
  indent = 0;
  indented = false;
  blank = false;
  partiallyConsumedTab = false;
  allClosed = true;
  refmap: Record<string, RefEntry> = {};
  inlineParser: InlineParser;

  constructor(options?: { smart?: boolean }) {
    this.inlineParser = new InlineParser(options ?? {});
  }

  // —— 行内位置工具（规范附录 A：按列数推进，tab 展开到 4 列制表位）——

  findNextNonspace(): void {
    const ln = this.currentLine;
    let i = this.offset;
    let cols = this.column;
    let c = '';
    while ((c = ln.charAt(i)) !== '') {
      if (c === ' ') {
        i++;
        cols++;
      } else if (c === '\t') {
        i++;
        cols += 4 - (cols % 4);
      } else {
        break;
      }
    }
    this.blank = c === '\n' || c === '\r' || c === '';
    this.nextNonspace = i;
    this.nextNonspaceColumn = cols;
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  advanceOffset(count: number, columns: boolean): void {
    const ln = this.currentLine;
    while (count > 0 && this.offset < ln.length) {
      const c = ln[this.offset]!;
      if (c === '\t') {
        const charsToTab = 4 - (this.column % 4);
        if (columns) {
          this.partiallyConsumedTab = charsToTab > count;
          const charsToAdvance = charsToTab > count ? count : charsToTab;
          this.column += charsToAdvance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          count -= charsToAdvance;
        } else {
          this.partiallyConsumedTab = false;
          this.column += charsToTab;
          this.offset += 1;
          count -= 1;
        }
      } else {
        this.partiallyConsumedTab = false;
        this.offset += 1;
        this.column += 1;
        count -= 1;
      }
    }
  }

  advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  addLine(): void {
    if (this.partiallyConsumedTab) {
      this.offset += 1; // 跳过 tab 本身，用展开后的空格替代
      const charsToTab = 4 - (this.column % 4);
      this.tip.stringContent += ' '.repeat(charsToTab);
    }
    this.tip.stringContent += this.currentLine.slice(this.offset) + '\n';
  }

  addChild(tag: string, offset: number): MdNode {
    while (!this.canContain(this.tip.type, tag)) {
      this.finalize(this.tip, this.lineNumber - 1);
    }
    const block = new MdNode(tag);
    block.startLine = this.lineNumber;
    block.open = true;
    this.tip.appendChild(block);
    this.tip = block;
    return block;
  }

  canContain(parentType: string, childType: string): boolean {
    switch (parentType) {
      case 'document':
      case 'block_quote':
      case 'item':
        return childType !== 'item';
      case 'list':
        return childType === 'item';
      default:
        return false; // 叶块与段落不接受子块
    }
  }

  acceptsLines(type: string): boolean {
    return type === 'paragraph' || type === 'code_block' || type === 'html_block';
  }

  closeUnmatchedBlocks(): void {
    if (!this.allClosed) {
      while (this.oldtip !== this.lastMatchedContainer) {
        const parent = this.oldtip.parent!;
        this.finalize(this.oldtip, this.lineNumber - 1);
        this.oldtip = parent;
      }
      this.allClosed = true;
    }
  }

  finalize(block: MdNode, endLine: number): void {
    const above = block.parent;
    block.open = false;
    block.endLine = endLine;
    this.finalizeBlock(block);
    this.tip = above!;
  }

  // —— 各块类型的 finalize 后处理 ——

  finalizeBlock(block: MdNode): void {
    switch (block.type) {
      case 'document':
        this.removeLinkReferenceDefinitions();
        break;
      case 'list':
        this.finalizeList(block);
        // 列表结束行取最后一个 item 的结束行
        if (block.lastChild !== null) block.endLine = block.lastChild.endLine;
        break;
      case 'item':
        // item 结束行取最后一个子块的结束行（空 item 则为起始行）——
        // 这是块间空行判定（松紧判定）的依据
        if (block.lastChild !== null) {
          block.endLine = block.lastChild.endLine;
        } else {
          block.endLine = block.startLine;
        }
        break;
      case 'code_block':
        this.finalizeCodeBlock(block);
        break;
      case 'html_block':
        block.literal = block.stringContent.replace(/\n$/, '');
        block.stringContent = '';
        break;
      default:
        break;
    }
  }

  finalizeList(block: MdNode): void {
    // 松紧判定：任何非末项以空行结尾，或任一 item 内部两块之间夹空行 → 松
    const data = block.listData!;
    for (const item of block.children) {
      if (item.next() && this.endsWithBlankLine(item)) {
        data.tight = false;
        break;
      }
      for (const subitem of item.children) {
        if (subitem.next() && this.endsWithBlankLine(subitem)) {
          data.tight = false;
          break;
        }
      }
      if (!data.tight) break;
    }
  }

  /** 块与其下一个兄弟之间是否隔了空行（结束行号不相邻） */
  endsWithBlankLine(block: MdNode): boolean {
    const next = block.next();
    return next !== null && block.endLine !== next.startLine - 1;
  }

  finalizeCodeBlock(block: MdNode): void {
    if (block.isFenced) {
      const content = block.stringContent;
      const newlinePos = content.indexOf('\n');
      const firstLine = newlinePos >= 0 ? content.slice(0, newlinePos) : content;
      const rest = newlinePos >= 0 ? content.slice(newlinePos + 1) : '';
      block.info = unescapeString(firstLine.trim());
      block.literal = rest;
    } else {
      const lines = block.stringContent.split('\n');
      // 末尾空行不属于代码块内容
      while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1]!)) {
        lines.pop();
      }
      block.literal = lines.join('\n') + '\n';
    }
    block.stringContent = '';
  }

  removeLinkReferenceDefinitions(): void {
    // 遍历所有段落，从段首剥离链接引用定义（只有段首才可能是 LRD）
    const empties: MdNode[] = [];
    const walk = (node: MdNode): void => {
      for (const child of node.children) {
        if (child.type === 'paragraph') {
          let hasRefs = false;
          while (
            child.stringContent.charCodeAt(0) === C_OPEN_BRACKET &&
            this.parseReferenceInto(child)
          ) {
            hasRefs = true;
          }
          if (hasRefs && isBlankStr(child.stringContent)) {
            empties.push(child);
          }
        } else {
          walk(child);
        }
      }
    };
    walk(this.doc);
    for (const node of empties) node.unlink();
  }

  private parseReferenceInto(node: MdNode): boolean {
    const pos = this.inlineParser.parseReference(node.stringContent, this.refmap);
    if (pos > 0) node.stringContent = node.stringContent.slice(pos);
    return pos > 0;
  }

  // —— 列表标记解析（规范 5.1 规则 1-3）——

  parseListMarker(container: MdNode): ListData | null {
    const rest = this.currentLine.slice(this.nextNonspace);
    if (this.indent >= 4) return null;
    const data: ListData = {
      type: 'bullet',
      tight: true,
      padding: 0,
      markerOffset: this.indent,
    };
    let markerLen = 0;
    let m: RegExpMatchArray | null;
    if ((m = rest.match(reBulletListMarker))) {
      data.bulletChar = m[0]!;
      markerLen = m[0].length;
    } else if ((m = rest.match(reOrderedListMarker))) {
      // 打断段落的有序列表起点必须是 1（"01." 亦视作 1）
      if (container.type === 'paragraph' && parseInt(m[1]!, 10) !== 1) return null;
      data.type = 'ordered';
      data.start = parseInt(m[1]!, 10);
      data.delim = m[2]!;
      markerLen = m[0]!.length;
    } else {
      return null;
    }
    // 标记后必须有空白或行尾
    const nextc = peekAt(this.currentLine, this.nextNonspace + markerLen);
    if (!(nextc === -1 || nextc === 9 || nextc === 32)) return null;
    // 若打断段落：首行不能是空行
    if (
      container.type === 'paragraph' &&
      !this.currentLine.slice(this.nextNonspace + markerLen).match(reNonSpace)
    ) {
      return null;
    }

    // 推进到标记末尾，数标记后的空格（最多看 5 列）
    this.advanceNextNonspace();
    this.advanceOffset(markerLen, true);
    const spacesStartCol = this.column;
    const spacesStartOffset = this.offset;
    let c: number;
    do {
      this.advanceOffset(1, true);
      c = peekAt(this.currentLine, this.offset);
    } while (this.column - spacesStartCol < 5 && isSpaceOrTab(c));
    const blankItem = peekAt(this.currentLine, this.offset) === -1;
    const spacesAfterMarker = this.column - spacesStartCol;
    if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
      // 5 空格以上按“1 空格 + 剩余缩进”处理；空 item 固定按 1 空格
      data.padding = markerLen + 1;
      this.column = spacesStartCol;
      this.offset = spacesStartOffset;
      if (isSpaceOrTab(peekAt(this.currentLine, this.offset))) {
        this.advanceOffset(1, true);
      }
    } else {
      data.padding = markerLen + spacesAfterMarker;
    }
    return data;
  }

  listsMatch(list: ListData | null, item: ListData): boolean {
    return (
      list !== null &&
      list.type === item.type &&
      list.delim === item.delim &&
      list.bulletChar === item.bulletChar
    );
  }

  // —— 块起始尝试（按优先级从左到右）——
  // 返回：0 = 不匹配；1 = 匹配到容器（继续尝试）；2 = 匹配到叶块（停止尝试）

  startBlockQuote(): 0 | 1 | 2 {
    if (!this.indented && peekAt(this.currentLine, this.nextNonspace) === C_GREATERTHAN) {
      this.advanceNextNonspace();
      this.advanceOffset(1, false);
      if (isSpaceOrTab(peekAt(this.currentLine, this.offset))) {
        this.advanceOffset(1, true);
      }
      this.closeUnmatchedBlocks();
      this.addChild('block_quote', this.nextNonspace);
      return 1;
    }
    return 0;
  }

  startATXHeading(): 0 | 1 | 2 {
    if (this.indented) return 0;
    const m = this.currentLine.slice(this.nextNonspace).match(reATXHeadingMarker);
    if (!m) return 0;
    this.advanceNextNonspace();
    this.advanceOffset(m[0]!.length, false);
    this.closeUnmatchedBlocks();
    const heading = this.addChild('heading', this.nextNonspace);
    heading.level = m[0]!.trim().length;
    heading.stringContent = this.currentLine
      .slice(this.offset)
      .replace(/^[ \t]*#+[ \t]*$/, '')
      .replace(/[ \t]+#+[ \t]*$/, '');
    this.advanceOffset(this.currentLine.length - this.offset, false);
    return 2;
  }

  startFence(): 0 | 1 | 2 {
    if (this.indented) return 0;
    const m = this.currentLine.slice(this.nextNonspace).match(reCodeFence);
    if (!m) return 0;
    const fenceLength = m[0]!.length;
    this.closeUnmatchedBlocks();
    const code = this.addChild('code_block', this.nextNonspace);
    code.isFenced = true;
    code.fenceLength = fenceLength;
    code.fenceChar = m[0]![0]!;
    code.fenceOffset = this.indent;
    this.advanceNextNonspace();
    this.advanceOffset(fenceLength, false);
    return 2;
  }

  startHtmlBlock(container: MdNode): 0 | 1 | 2 {
    if (this.indented || peekAt(this.currentLine, this.nextNonspace) !== C_LESSTHAN) return 0;
    const s = this.currentLine.slice(this.nextNonspace);
    for (let blockType = 1; blockType <= 7; blockType++) {
      if (
        reHtmlBlockOpen[blockType]!.test(s) &&
        (blockType < 7 ||
          // 类型 7 不能打断段落，也不能是惰性续行
          (container.type !== 'paragraph' &&
            !(!this.allClosed && !this.blank && this.tip.type === 'paragraph')))
      ) {
        this.closeUnmatchedBlocks();
        // 不推进 offset：前导空格属于 HTML 块内容
        const b = this.addChild('html_block', this.offset);
        b.htmlBlockType = blockType;
        return 2;
      }
    }
    return 0;
  }

  startSetextHeading(container: MdNode): 0 | 1 | 2 {
    if (this.indented || container.type !== 'paragraph') return 0;
    const m = this.currentLine.slice(this.nextNonspace).match(reSetextHeadingLine);
    if (!m) return 0;
    this.closeUnmatchedBlocks();
    // 先剥离段首的链接引用定义（规范 4.8：LRD 可直接跟在其他块后）
    while (
      container.stringContent.charCodeAt(0) === C_OPEN_BRACKET &&
      this.parseReferenceInto(container)
    ) {
      /* 剥离 */
    }
    if (container.stringContent.length > 0) {
      const heading = new MdNode('heading');
      heading.level = m[0]![0] === '=' ? 1 : 2;
      heading.stringContent = container.stringContent;
      heading.startLine = container.startLine;
      heading.open = true;
      container.insertAfter(heading);
      container.unlink();
      this.tip = heading;
      this.advanceOffset(this.currentLine.length - this.offset, false);
      return 2;
    }
    return 0;
  }

  startThematicBreak(): 0 | 1 | 2 {
    if (this.indented) return 0;
    if (!reThematicBreak.test(this.currentLine.slice(this.nextNonspace))) return 0;
    this.closeUnmatchedBlocks();
    this.addChild('thematic_break', this.nextNonspace);
    this.advanceOffset(this.currentLine.length - this.offset, false);
    return 2;
  }

  startListItem(container: MdNode): 0 | 1 | 2 {
    // 4 列以上缩进通常不成列表；但当前容器就是 list 时仍尝试（同层续项）
    if (this.indented && container.type !== 'list') return 0;
    const data = this.parseListMarker(container);
    if (!data) return 0;
    this.closeUnmatchedBlocks();
    let list: MdNode;
    const tipList = this.tip.type === 'list' ? this.tip : null;
    if (tipList === null || !this.listsMatch(tipList.listData, data)) {
      list = this.addChild('list', this.nextNonspace);
      list.listData = { ...data };
    } else {
      list = tipList;
    }
    const item = this.addChild('item', this.nextNonspace);
    item.listData = data;
    return 1;
  }

  startIndentedCode(): 0 | 1 | 2 {
    if (this.indented && this.tip.type !== 'paragraph' && !this.blank) {
      this.advanceOffset(CODE_INDENT, true);
      this.closeUnmatchedBlocks();
      this.addChild('code_block', this.offset);
      return 2;
    }
    return 0;
  }

  // —— 各块类型的 continue（本行能否延续该块）——

  continueBlock(container: MdNode): ContinueResult {
    switch (container.type) {
      case 'document':
      case 'list':
        return 0;
      case 'block_quote': {
        if (!this.indented && peekAt(this.currentLine, this.nextNonspace) === C_GREATERTHAN) {
          this.advanceNextNonspace();
          this.advanceOffset(1, false);
          if (isSpaceOrTab(peekAt(this.currentLine, this.offset))) {
            this.advanceOffset(1, true);
          }
          return 0;
        }
        return 1;
      }
      case 'item': {
        const data = container.listData!;
        if (this.blank) {
          if (container.firstChild === null) {
            return 1; // 空 item 后的空行关闭该 item
          }
          this.advanceNextNonspace();
          return 0;
        }
        if (this.indent >= data.markerOffset + data.padding) {
          this.advanceOffset(data.markerOffset + data.padding, true);
          return 0;
        }
        return 1;
      }
      case 'heading':
      case 'thematic_break':
        return 1; // 均为单行块
      case 'code_block': {
        if (container.isFenced) {
          // 闭栏判定：同字符、不少于开栏长度、≤3 缩进、行尾无别的内容
          const ln = this.currentLine;
          const match =
            this.indent <= 3 &&
            ln.charAt(this.nextNonspace) === container.fenceChar &&
            ln.slice(this.nextNonspace).match(reClosingCodeFence);
          if (match && match[0]!.length >= container.fenceLength) {
            this.finalize(container, this.lineNumber);
            return 2;
          }
          // 跳过与开栏缩进等量的空白
          let i = container.fenceOffset;
          while (i > 0 && isSpaceOrTab(peekAt(ln, this.offset))) {
            this.advanceOffset(1, true);
            i--;
          }
          return 0;
        }
        if (this.indent >= CODE_INDENT) {
          this.advanceOffset(CODE_INDENT, true);
          return 0;
        } else if (this.blank) {
          this.advanceNextNonspace();
          return 0;
        }
        return 1;
      }
      case 'html_block':
        return this.blank && (container.htmlBlockType === 6 || container.htmlBlockType === 7)
          ? 1
          : 0;
      case 'paragraph':
        return this.blank ? 1 : 0;
      default:
        return 1;
    }
  }

  // —— 主入口：逐行吸收 ——

  incorporateLine(ln: string): void {
    let allMatched = true;
    let container = this.doc;
    this.oldtip = this.tip;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.lineNumber += 1;
    if (ln.indexOf('\u0000') !== -1) {
      ln = ln.replace(/\0/g, '\uFFFD');
    }
    this.currentLine = ln;

    // 阶段 1：自上而下尝试延续已打开的块
    let lastChild: MdNode | null;
    while ((lastChild = container.lastChild) !== null && lastChild.open) {
      container = lastChild;
      this.findNextNonspace();
      const r = this.continueBlock(container);
      if (r === 2) return; // 围栏闭合，本行处理完毕
      if (r === 1) {
        allMatched = false;
        container = container.parent!;
        break;
      }
    }

    this.allClosed = container === this.oldtip;
    this.lastMatchedContainer = container;

    // 阶段 2：自左而右尝试新的块起始（除非最深的匹配容器是接受文本的叶块）
    let matchedLeaf = container.type !== 'paragraph' && this.acceptsLines(container.type);
    const starts: Array<() => 0 | 1 | 2> = [
      () => this.startBlockQuote(),
      () => this.startATXHeading(),
      () => this.startFence(),
      () => this.startHtmlBlock(container),
      () => this.startSetextHeading(container),
      () => this.startThematicBreak(),
      () => this.startListItem(container),
      () => this.startIndentedCode(),
    ];
    while (!matchedLeaf) {
      this.findNextNonspace();
      // 性能捷径：首字符不在特殊集合时直接按文本处理
      if (!this.indented && !reMaybeSpecial.test(ln.slice(this.nextNonspace))) {
        this.advanceNextNonspace();
        break;
      }
      let i = 0;
      while (i < starts.length) {
        const res = starts[i]!();
        if (res === 1) {
          container = this.tip;
          break;
        } else if (res === 2) {
          container = this.tip;
          matchedLeaf = true;
          break;
        }
        i++;
      }
      if (i === starts.length) {
        this.advanceNextNonspace();
        break;
      }
    }

    // 阶段 3：剩余文本交给最深块；先看惰性段落续行
    if (!this.allClosed && !this.blank && this.tip.type === 'paragraph') {
      this.addLine();
    } else {
      this.closeUnmatchedBlocks();
      if (this.acceptsLines(container.type)) {
        this.addLine();
        // HTML 块 1-5 类：检查本行是否命中结束条件
        if (
          container.type === 'html_block' &&
          container.htmlBlockType >= 1 &&
          container.htmlBlockType <= 5 &&
          reHtmlBlockClose[container.htmlBlockType]!.test(this.currentLine.slice(this.offset))
        ) {
          this.finalize(container, this.lineNumber);
        }
      } else if (this.offset < ln.length && !this.blank) {
        container = this.addChild('paragraph', this.offset);
        this.advanceNextNonspace();
        this.addLine();
      }
    }
  }

  // —— 完整块级解析 ——

  parse(src: string): MdNode {
    this.doc = new MdNode('document');
    this.doc.open = true;
    this.tip = this.doc;
    this.oldtip = this.doc;
    this.lastMatchedContainer = this.doc;
    this.refmap = {};
    this.lineNumber = 0;
    this.lastLineLength = 0;
    const lines = src.split(/\r\n|\n|\r/);
    let len = lines.length;
    if (src.length > 0 && src.charCodeAt(src.length - 1) === 10) {
      len -= 1; // 末尾换行产生的空串不算一行
    }
    for (let i = 0; i < len; i++) {
      this.incorporateLine(lines[i]!);
    }
    while (this.tip !== null) {
      this.finalize(this.tip, len);
    }
    this.tip = this.doc;
    return this.doc;
  }
}
