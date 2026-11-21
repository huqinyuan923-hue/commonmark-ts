// 内联解析器：规范第 6 章 + 附录 A 的 delimiter 栈算法。
// 单趟扫描构建文本节点与潜在定界符（强调 run、方括号），
// 遇 ] 找链接/图片，收尾时 processEmphasis 按 17 条规则配对强调。
import { MdNode, RefEntry } from './ast.js';
import { ESCAPABLE, ENTITY_SRC, unescapeString, encodeUrl, normalizeReference } from './decode.js';
import { ENTITIES } from './entities.js';

// —— 词法正则（与规范语法定义一一对应）——
const rePunctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\p{P}\p{S}]/u;
const reUnicodeWhitespaceChar = /^\s/;
const reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/;
const reEscapable = new RegExp('^' + ESCAPABLE.source);

const ESCAPED_CHAR = '\\\\' + ESCAPABLE.source;
const reLinkTitle = new RegExp(
  '^(?:"(' +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    '|[^\\\\"\\x00])*"' +
    '|' +
    "'(" +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    "|[^\\\\'\\x00])*'" +
    '|' +
    '\\((' +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    '|[^\\\\()\\x00])*\\))',
);
const reLinkDestinationBraces = /^(?:<(?:[^<>\n\\\x00]|\\.)*>)/;
const reLinkLabel = /^\[(?:[^\\[\]]|\\.){0,1000}\]/s;
const reEntityHere = new RegExp('^' + ENTITY_SRC, 'i');
const reTicks = /`+/;
const reTicksHere = /^`+/;
const reEmailAutolink =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const reAutolink = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;
const reSpnl = /^ *(?:\n *)?/;
const reFinalSpace = / *$/;
const reInitialSpace = /^ */;
const reSpaceAtEndOfLine = /^ *(?:\n|$)/;
const reMain = /^[^\n`[\]\\!<&*_'"]+/m;

// HTML tag 语法（规范 6.11）：开标签/闭标签/注释/处理指令/声明/CDATA
const TAGNAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTENAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
const UNQUOTEDVALUE = '[^"\'=<>`\\x00-\\x20]+';
const SINGLEQUOTEDVALUE = "'[^']*'";
const DOUBLEQUOTEDVALUE = '"[^"]*"';
const ATTRIBUTEVALUE = '(?:' + UNQUOTEDVALUE + '|' + SINGLEQUOTEDVALUE + '|' + DOUBLEQUOTEDVALUE + ')';
const ATTRIBUTEVALUESPEC = '(?:' + '\\s*=' + '\\s*' + ATTRIBUTEVALUE + ')';
const ATTRIBUTE = '(?:' + '\\s+' + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + '?)';
const OPENTAG = '<' + TAGNAME + ATTRIBUTE + '*' + '\\s*/?>';
const CLOSETAG = '</' + TAGNAME + '\\s*[>]';
const HTMLCOMMENT = '<!-->|<!--->|<!--[\\s\\S]*?-->';
const PROCESSINGINSTRUCTION = '[<][?][\\s\\S]*?[?][>]';
const DECLARATION = '<![A-Za-z]+' + '[^>]*>';
const CDATA = '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>';
const reHtmlTag = new RegExp(
  '^(?:' + OPENTAG + '|' + CLOSETAG + '|' + HTMLCOMMENT + '|' + PROCESSINGINSTRUCTION + '|' + DECLARATION + '|' + CDATA + ')',
);

// smart 引号的替换目标
const C_SINGLEQUOTE = 39;
const C_DOUBLEQUOTE = 34;
const C_BACKSLASH = 92;
const C_NEWLINE = 10;
const C_UNDERSCORE = 95;
const C_ASTERISK = 42;

interface Delimiter {
  cc: number;
  numdelims: number;
  origdelims: number;
  node: MdNode;
  prev: Delimiter | null;
  next: Delimiter | null;
  canOpen: boolean;
  canClose: boolean;
}

interface BracketEntry {
  node: MdNode;
  prev: BracketEntry | null;
  previousDelimiter: Delimiter | null;
  index: number; // 开括号后第一个字符位置
  image: boolean;
  active: boolean;
  bracketAfter: boolean;
}

interface RefMap {
  [label: string]: RefEntry;
}

function textNode(s: string): MdNode {
  const n = new MdNode('text');
  n.literal = s;
  return n;
}

export interface InlineOptions {
  smart?: boolean;
}

export class InlineParser {
  subject = '';
  pos = 0;
  delimiters: Delimiter | null = null;
  brackets: BracketEntry | null = null;
  block: MdNode = new MdNode('text');
  refmap: RefMap = {};
  options: InlineOptions;

  constructor(options: InlineOptions = {}) {
    this.options = options;
  }

  // —— 基础工具 ——

  peek(): number {
    return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1;
  }

  /** 在当前位置匹配正则（不锚定 ^ 时等价于从头找），成功则推进 pos。
   * 全部传入正则均非全局标志，String.match 与 RegExp 运行语义一致。 */
  match(re: RegExp): string | null {
    const m = this.subject.slice(this.pos).match(re);
    if (m === null) return null;
    this.pos += m.index! + m[0]!.length;
    return m[0]!;
  }

  /** 零个或多个空格，至多一个换行 */
  spnl(): void {
    this.match(reSpnl);
  }

  // —— 主入口 ——

  parse(block: MdNode): void {
    this.block = block;
    this.subject = block.stringContent.trim();
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
    while (this.parseOne()) {
      /* 循环 */
    }
    this.processEmphasis(null);
    block.stringContent = '';
  }

  /** 解析下一个内联元素；无法识别的字符按普通文本处理 */
  parseOne(): boolean {
    const c = this.peek();
    if (c === -1) return false;
    let res: boolean;
    switch (c) {
      case C_NEWLINE:
        res = this.parseNewline();
        break;
      case C_BACKSLASH:
        res = this.parseBackslash();
        break;
      case 96 /* ` */:
        res = this.parseBackticks();
        break;
      case C_ASTERISK:
      case C_UNDERSCORE:
        res = this.handleDelim(c);
        break;
      case C_SINGLEQUOTE:
      case C_DOUBLEQUOTE:
        res = this.options.smart === true && this.handleDelim(c);
        break;
      case 91 /* [ */:
        res = this.parseOpenBracket();
        break;
      case 33 /* ! */:
        res = this.parseBang();
        break;
      case 93 /* ] */:
        res = this.parseCloseBracket();
        break;
      case 60 /* < */:
        res = this.parseAutolink() || this.parseHtmlTagInline();
        break;
      case 38 /* & */:
        res = this.parseEntity();
        break;
      default:
        res = this.parseString();
        break;
    }
    if (!res) {
      this.pos += 1;
      this.block.appendChild(textNode(String.fromCodePoint(c)));
    }
    return true;
  }

  // —— 各类内联元素 ——

  parseNewline(): boolean {
    this.pos += 1; // 跳过 \n
    const lastc = this.block.lastChild;
    if (lastc !== null && lastc.type === 'text' && (lastc.literal ?? '').endsWith(' ')) {
      const lit = lastc.literal!;
      const hardbreak = lit.length >= 2 && lit.charAt(lit.length - 2) === ' ';
      lastc.literal = lit.replace(reFinalSpace, '');
      this.block.appendChild(new MdNode(hardbreak ? 'linebreak' : 'softbreak'));
    } else {
      this.block.appendChild(new MdNode('softbreak'));
    }
    this.match(reInitialSpace); // 吞掉下一行行首空格
    return true;
  }

  parseBackslash(): boolean {
    this.pos += 1;
    if (this.peek() === C_NEWLINE) {
      this.pos += 1;
      this.block.appendChild(new MdNode('linebreak'));
    } else if (reEscapable.test(this.subject.charAt(this.pos))) {
      this.block.appendChild(textNode(this.subject.charAt(this.pos)));
      this.pos += 1;
    } else {
      this.block.appendChild(textNode('\\'));
    }
    return true;
  }

  parseBackticks(): boolean {
    const ticks = this.match(reTicksHere);
    if (ticks === null) return false;
    const afterOpenTicks = this.pos;
    let matched: string | null;
    while ((matched = this.match(reTicks)) !== null) {
      if (matched === ticks) {
        const node = new MdNode('code');
        let contents = this.subject
          .slice(afterOpenTicks, this.pos - ticks.length)
          .replace(/\n/g, ' ');
        // 首尾都是空格且非全空格 → 各剥一个
        if (
          contents.length > 0 &&
          /[^ ]/.test(contents) &&
          contents.charAt(0) === ' ' &&
          contents.charAt(contents.length - 1) === ' '
        ) {
          contents = contents.slice(1, contents.length - 1);
        }
        node.literal = contents;
        this.block.appendChild(node);
        return true;
      }
    }
    this.pos = afterOpenTicks;
    this.block.appendChild(textNode(ticks));
    return true;
  }

  /** 扫描定界符 run，计算左右缘合性与开/闭资格 */
  scanDelims(cc: number): { numdelims: number; canOpen: boolean; canClose: boolean } | null {
    let numdelims = 0;
    const startpos = this.pos;
    if (cc === C_SINGLEQUOTE || cc === C_DOUBLEQUOTE) {
      numdelims += 1;
      this.pos += 1;
    } else {
      while (this.peek() === cc) {
        numdelims += 1;
        this.pos += 1;
      }
    }
    if (numdelims === 0) return null;

    const charBefore = startpos === 0 ? '\n' : this.subject.charAt(startpos - 1);
    const charAfter = this.pos >= this.subject.length ? '\n' : this.subject.charAt(this.pos);

    const afterIsWhitespace = reUnicodeWhitespaceChar.test(charAfter);
    const afterIsPunctuation = rePunctuation.test(charAfter);
    const beforeIsWhitespace = reUnicodeWhitespaceChar.test(charBefore);
    const beforeIsPunctuation = rePunctuation.test(charBefore);

    const leftFlanking =
      !afterIsWhitespace && (!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation);
    const rightFlanking =
      !beforeIsWhitespace && (!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation);

    let canOpen: boolean;
    let canClose: boolean;
    if (cc === C_UNDERSCORE) {
      // 规则 3/4（单下划线）与规则 6/8（双下划线）：词内限制
      canOpen = leftFlanking && (!rightFlanking || beforeIsPunctuation);
      canClose = rightFlanking && (!leftFlanking || afterIsPunctuation);
    } else if (cc === C_SINGLEQUOTE || cc === C_DOUBLEQUOTE) {
      canOpen = leftFlanking && !rightFlanking;
      canClose = rightFlanking;
    } else {
      canOpen = leftFlanking;
      canClose = rightFlanking;
    }
    this.pos = startpos;
    return { numdelims, canOpen, canClose };
  }

  handleDelim(cc: number): boolean {
    const res = this.scanDelims(cc);
    if (res === null) return false;
    const startpos = this.pos;
    this.pos += res.numdelims;
    let contents: string;
    if (cc === C_SINGLEQUOTE) {
      contents = '\u2019';
    } else if (cc === C_DOUBLEQUOTE) {
      contents = '\u201C';
    } else {
      contents = this.subject.slice(startpos, this.pos);
    }
    const node = textNode(contents);
    this.block.appendChild(node);
    if (
      (res.canOpen || res.canClose) &&
      (this.options.smart || (cc !== C_SINGLEQUOTE && cc !== C_DOUBLEQUOTE))
    ) {
      const d: Delimiter = {
        cc,
        numdelims: res.numdelims,
        origdelims: res.numdelims,
        node,
        prev: this.delimiters,
        next: null,
        canOpen: res.canOpen,
        canClose: res.canClose,
      };
      if (d.prev !== null) d.prev.next = d;
      this.delimiters = d;
    }
    return true;
  }

  removeDelimiter(delim: Delimiter): void {
    if (delim.prev !== null) delim.prev.next = delim.next;
    if (delim.next === null) {
      this.delimiters = delim.prev; // 栈顶
    } else {
      delim.next.prev = delim.prev;
    }
  }

  removeDelimitersBetween(bottom: Delimiter, top: Delimiter): void {
    if (bottom.next !== top) {
      bottom.next = top;
      top.prev = bottom;
    }
  }

  // —— 括号（链接/图片）——

  parseOpenBracket(): boolean {
    const startpos = this.pos;
    this.pos += 1;
    const node = textNode('[');
    this.block.appendChild(node);
    if (this.brackets !== null) {
      this.brackets.bracketAfter = true;
    }
    this.brackets = {
      node,
      prev: this.brackets,
      previousDelimiter: this.delimiters,
      index: startpos, // 存 '[' 的位置（引用标签原文含方括号，归一化时剥去）
      image: false,
      active: true,
      bracketAfter: false,
    };
    return true;
  }

  parseBang(): boolean {
    const startpos = this.pos;
    this.pos += 1;
    if (this.peek() === 91 /* [ */) {
      this.pos += 1;
      const node = textNode('![');
      this.block.appendChild(node);
      if (this.brackets !== null) {
        this.brackets.bracketAfter = true;
      }
      this.brackets = {
        node,
        prev: this.brackets,
        previousDelimiter: this.delimiters,
        index: startpos + 1, // 存 '[' 的位置（'!' 的下一字符）
        image: true,
        active: true,
        bracketAfter: false,
      };
    } else {
      this.block.appendChild(textNode('!'));
    }
    return true;
  }

  parseCloseBracket(): boolean {
    this.pos += 1;
    const startpos = this.pos; // ] 之后的位置

    const opener = this.brackets;
    if (opener === null) {
      this.block.appendChild(textNode(']'));
      return true;
    }
    if (!opener.active) {
      this.block.appendChild(textNode(']'));
      this.removeBracket();
      return true;
    }

    const isImage = opener.image;
    let dest: string | null = null;
    let title: string | null = null;
    let matched = false;
    const savepos = this.pos;

    // 1) 内联链接 [text](dest "title")
    if (this.peek() === 40 /* ( */) {
      this.pos += 1;
      this.spnl();
      dest = this.parseLinkDestination();
      if (dest !== null) {
        this.spnl();
        // 标题前必须有空白
        if (reWhitespaceChar.test(this.subject.charAt(this.pos - 1))) {
          title = this.parseLinkTitle();
        }
        this.spnl();
        if (this.peek() === 41 /* ) */) {
          this.pos += 1;
          matched = true;
        } else {
          this.pos = savepos;
          dest = null;
          title = null;
        }
      } else {
        this.pos = savepos;
      }
    }

    // 2) 引用链接 [text][label] / [text][] / [text]
    if (!matched) {
      const beforelabel = this.pos;
      const n = this.parseLinkLabel();
      let reflabel: string | null = null;
      if (n > 2) {
        reflabel = this.subject.slice(beforelabel, beforelabel + n);
      } else if (!opener.bracketAfter) {
        // 空缺或缺失的第二个标签：用第一个标签的原文做引用
        reflabel = this.subject.slice(opener.index, startpos);
        if (n === 0) {
          this.pos = savepos; // shortcut：不吞空格
        }
      } else if (n === 0) {
        this.pos = savepos; // 无标签且不能 shortcut：回退
      }
      if (reflabel !== null) {
        const ref = this.refmap[normalizeReference(reflabel)];
        if (ref) {
          dest = ref.dest;
          title = ref.title;
          matched = true;
        }
      }
    }

    if (matched) {
      const node = new MdNode(isImage ? 'image' : 'link');
      node.destination = dest;
      node.title = title ?? '';
      // 把开括号节点之后的兄弟全部收进链接/图片
      let tmp = opener.node.next();
      while (tmp !== null) {
        const next = tmp.next();
        tmp.unlink();
        node.appendChild(tmp);
        tmp = next;
      }
      this.block.appendChild(node);
      this.processEmphasis(opener.previousDelimiter);
      this.removeBracket();
      opener.node.unlink();
      if (!isImage) {
        // 链接不可嵌套：禁用所有更早的非图片括号
        let b = this.brackets;
        while (b !== null) {
          if (!b.image) b.active = false;
          b = b.prev;
        }
      }
      return true;
    }
    // 未匹配：还原为字面 ]
    this.removeBracket();
    this.pos = startpos;
    this.block.appendChild(textNode(']'));
    return true;
  }

  removeBracket(): void {
    this.brackets = this.brackets!.prev;
  }

  parseAutolink(): boolean {
    let m = this.match(reEmailAutolink);
    if (m !== null) {
      const dest = m.slice(1, m.length - 1);
      const node = new MdNode('link');
      node.destination = encodeUrl('mailto:' + dest);
      node.title = '';
      node.appendChild(textNode(dest));
      this.block.appendChild(node);
      return true;
    }
    m = this.match(reAutolink);
    if (m !== null) {
      const dest = m.slice(1, m.length - 1);
      const node = new MdNode('link');
      node.destination = encodeUrl(dest);
      node.title = '';
      node.appendChild(textNode(dest));
      this.block.appendChild(node);
      return true;
    }
    return false;
  }

  parseHtmlTagInline(): boolean {
    const m = this.match(reHtmlTag);
    if (m === null) return false;
    const node = new MdNode('html_inline');
    node.literal = m;
    this.block.appendChild(node);
    return true;
  }

  parseEntity(): boolean {
    const m = this.match(reEntityHere);
    if (m === null) return false;
    this.block.appendChild(textNode(this.decodeEntity(m)));
    return true;
  }

  /** 实体/数字字符引用解码（命名精确匹配 HTML5 表；数字越界→U+FFFD） */
  decodeEntity(m: string): string {
    const body = m.slice(1, -1);
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return '\uFFFD';
      }
      return String.fromCodePoint(cp);
    }
    return ENTITIES[body] ?? m;
  }

  parseString(): boolean {
    const m = this.match(reMain);
    if (m === null) return false;
    if (this.options.smart) {
      this.block.appendChild(textNode(this.smartTransform(m)));
    } else {
      this.block.appendChild(textNode(m));
    }
    return true;
  }

  /** smart：... → …；-- 连字符 → 长/短破折号（按 3/2 分摊规则） */
  smartTransform(m: string): string {
    let s = m.replace(/\.\.\./g, '\u2026');
    s = s.replace(/--+/g, (chars) => {
      let enCount = 0;
      let emCount = 0;
      if (chars.length % 3 === 0) {
        emCount = chars.length / 3;
      } else if (chars.length % 2 === 0) {
        enCount = chars.length / 2;
      } else if (chars.length % 3 === 2) {
        enCount = 1;
        emCount = (chars.length - 2) / 3;
      } else {
        enCount = 2;
        emCount = (chars.length - 4) / 3;
      }
      return '\u2014'.repeat(emCount) + '\u2013'.repeat(enCount);
    });
    return s;
  }

  // —— 链接目的地 / 标题 / 标签 ——

  parseLinkDestination(): string | null {
    const res = this.match(reLinkDestinationBraces);
    if (res !== null) {
      return encodeUrl(unescapeString(res.slice(1, -1)));
    }
    if (this.peek() === 60 /* < */) return null;
    const savepos = this.pos;
    let openparens = 0;
    let c = -1;
    while ((c = this.peek()) !== -1) {
      if (c === C_BACKSLASH && reEscapable.test(this.subject.charAt(this.pos + 1))) {
        this.pos += 1;
        if (this.peek() !== -1) this.pos += 1;
      } else if (c === 40 /* ( */) {
        this.pos += 1;
        openparens += 1;
      } else if (c === 41 /* ) */) {
        if (openparens < 1) break;
        this.pos += 1;
        openparens -= 1;
      } else if (reWhitespaceChar.test(String.fromCodePoint(c))) {
        break;
      } else {
        this.pos += 1;
      }
    }
    if (this.pos === savepos && c !== 41) return null;
    if (openparens !== 0) return null;
    return encodeUrl(unescapeString(this.subject.slice(savepos, this.pos)));
  }

  parseLinkTitle(): string | null {
    const title = this.match(reLinkTitle);
    if (title === null) return null;
    return unescapeString(title.slice(1, -1));
  }

  parseLinkLabel(): number {
    const m = this.match(reLinkLabel);
    if (m === null || m.length > 1001) return 0;
    return m.length;
  }

  /** 链接引用定义解析（块级收尾用）；返回消费的字符数，失败返回 0 */
  parseReference(s: string, refmap: RefMap): number {
    this.subject = s;
    this.pos = 0;
    const startpos = this.pos;

    const matchChars = this.parseLinkLabel();
    if (matchChars === 0) return 0;
    const rawlabel = this.subject.slice(0, matchChars);

    if (this.peek() !== 58 /* : */) {
      this.pos = startpos;
      return 0;
    }
    this.pos += 1;

    this.spnl();
    const dest = this.parseLinkDestination();
    if (dest === null) {
      this.pos = startpos;
      return 0;
    }

    const beforetitle = this.pos;
    this.spnl();
    let title: string | null = null;
    if (this.pos !== beforetitle) {
      title = this.parseLinkTitle();
    }
    if (title === null) {
      this.pos = beforetitle;
    }

    // 必须到达行尾（标题不合法时可退掉标题重试）
    let atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
    if (!atLineEnd && title !== null) {
      title = null;
      this.pos = beforetitle;
      atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
    }
    if (!atLineEnd) {
      this.pos = startpos;
      return 0;
    }

    const normlabel = normalizeReference(rawlabel);
    if (normlabel === '') {
      this.pos = startpos;
      return 0;
    }
    if (refmap[normlabel] === undefined) {
      refmap[normlabel] = { dest, title: title ?? '' };
    }
    return this.pos - startpos;
  }

  // —— 强调配对：规范 6.4 规则 9-17 + 附录算法 ——

  processEmphasis(stackBottom: Delimiter | null): void {
    // openers_bottom：按 closer 种类（引号 2 种 + 下划线/星号 × canOpen × origdelims%3）缓存搜索下界
    const openersBottom: (Delimiter | null)[] = new Array(14).fill(stackBottom);
    let closer = this.delimiters;
    while (closer !== null && closer.prev !== stackBottom) {
      closer = closer.prev;
    }
    while (closer !== null) {
      const closercc = closer.cc;
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      let openersBottomIndex: number;
      switch (closercc) {
        case C_SINGLEQUOTE:
          openersBottomIndex = 0;
          break;
        case C_DOUBLEQUOTE:
          openersBottomIndex = 1;
          break;
        case C_UNDERSCORE:
          openersBottomIndex = 2 + (closer.canOpen ? 3 : 0) + (closer.origdelims % 3);
          break;
        default: // '*'
          openersBottomIndex = 8 + (closer.canOpen ? 3 : 0) + (closer.origdelims % 3);
          break;
      }
      // 回找第一个同字符可开定界符（跳过 odd match：和为 3 的倍数且非双方皆 3 的倍数）
      let opener: Delimiter | null = closer.prev;
      let foundOpener: Delimiter | null = null;
      while (
        opener !== null &&
        opener !== stackBottom &&
        opener !== openersBottom[openersBottomIndex]!
      ) {
        const oddMatch =
          (closer.canOpen || opener.canClose) &&
          closer.origdelims % 3 !== 0 &&
          (opener.origdelims + closer.origdelims) % 3 === 0;
        if (opener.cc === closercc && opener.canOpen && !oddMatch) {
          foundOpener = opener;
          break;
        }
        opener = opener.prev;
      }
      const openerFound = foundOpener !== null;
      const oldCloser = closer;

      if (closercc === C_ASTERISK || closercc === C_UNDERSCORE) {
        if (!openerFound) {
          closer = closer.next;
        } else {
          const opener2 = foundOpener!;
          const useDelims = closer.numdelims >= 2 && opener2.numdelims >= 2 ? 2 : 1;
          const openerInl = opener2.node;
          const closerInl = closer.node;

          // 从两侧定界符节点里扣掉用掉的数量
          opener2.numdelims -= useDelims;
          closer.numdelims -= useDelims;
          const openerLit = openerInl.literal ?? '';
          const closerLit = closerInl.literal ?? '';
          openerInl.literal = openerLit.slice(0, openerLit.length - useDelims);
          closerInl.literal = closerLit.slice(0, closerLit.length - useDelims);

          // 收拢 opener 与 closer 之间的兄弟节点为强调内容
          const emph = new MdNode(useDelims === 1 ? 'emph' : 'strong');
          let tmp = openerInl.next();
          while (tmp !== null && tmp !== closerInl) {
            const next = tmp.next();
            tmp.unlink();
            emph.appendChild(tmp);
            tmp = next;
          }
          openerInl.insertAfter(emph);

          this.removeDelimitersBetween(opener2, closer);

          if (opener2.numdelims === 0) {
            openerInl.unlink();
            this.removeDelimiter(opener2);
          }
          if (closer.numdelims === 0) {
            closerInl.unlink();
            const tempstack = closer.next;
            this.removeDelimiter(closer);
            closer = tempstack;
          }
        }
      } else if (closercc === C_SINGLEQUOTE) {
        closer.node.literal = '\u2019';
        if (openerFound && foundOpener!.node.literal !== null) {
          foundOpener!.node.literal = '\u2018';
        }
        closer = closer.next;
      } else if (closercc === C_DOUBLEQUOTE) {
        closer.node.literal = '\u201D';
        if (openerFound && foundOpener!.node.literal !== null) {
          foundOpener!.node.literal = '\u201C';
        }
        closer = closer.next;
      }

      if (!openerFound) {
        openersBottom[openersBottomIndex] = oldCloser.prev;
        if (!oldCloser.canOpen) {
          this.removeDelimiter(oldCloser);
        }
      }
    }
    // 清栈：stackBottom 之上的定界符全部移除（节点保留为字面文本）
    while (this.delimiters !== null && this.delimiters !== stackBottom) {
      this.removeDelimiter(this.delimiters);
    }
  }
}
