// HTML 渲染器：与规范示例的 HTML 逐字符一致。
// 精确复刻 cr()/lit() 条件换行模型：块级标签前后按需补换行，避免多余空行。
import { MdNode } from './ast.js';

/** XML/HTML 转义（文本、属性、URL 一律走这里） */
function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}

export interface RenderOptions {
  /** 软换行渲染为硬换行 <br />（默认按规范渲染为换行符） */
  softbreakHard?: boolean;
}

export function renderHtml(root: MdNode, opts: RenderOptions = {}): string {
  let buffer = '';
  let lastOut = '\n';
  let disableTags = 0; // >0 时屏蔽标签输出（image 的 alt 内容）
  const softbreak = opts.softbreakHard ? '<br />\n' : '\n';

  const lit = (s: string): void => {
    buffer += s;
    lastOut = s;
  };
  const cr = (): void => {
    if (lastOut !== '\n') lit('\n');
  };
  const out = (s: string): void => {
    lit(escapeXml(s));
  };
  const tag = (name: string, attrs: Array<[string, string]> = [], selfclosing = false): void => {
    if (disableTags > 0) return;
    let s = '<' + name;
    for (const [k, v] of attrs) {
      s += ' ' + k + '="' + v + '"';
    }
    if (selfclosing) s += ' /';
    lit(s + '>');
  };

  const renderChildren = (node: MdNode): void => {
    for (const child of node.children) renderNode(child);
  };

  const renderNode = (node: MdNode): void => {
    switch (node.type) {
      case 'text':
        out(node.literal ?? '');
        break;
      case 'softbreak':
        lit(softbreak);
        break;
      case 'linebreak':
        tag('br', [], true);
        cr();
        break;
      case 'code':
        tag('code');
        out(node.literal ?? '');
        tag('/code');
        break;
      case 'html_inline':
        // 原始 HTML 原样输出（不受 disableTags 屏蔽影响）
        lit(node.literal ?? '');
        break;
      case 'emph':
        tag('em');
        renderChildren(node);
        tag('/em');
        break;
      case 'strong':
        tag('strong');
        renderChildren(node);
        tag('/strong');
        break;
      case 'link': {
        const attrs: Array<[string, string]> = [['href', escapeXml(node.destination ?? '')]];
        if (node.title) {
          attrs.push(['title', escapeXml(node.title)]);
        }
        tag('a', attrs);
        renderChildren(node);
        tag('/a');
        break;
      }
      case 'image': {
        // alt 内容：子内联节点照常渲染但标签被屏蔽，只留转义后的纯文本
        if (disableTags === 0) {
          lit('<img src="' + escapeXml(node.destination ?? '') + '" alt="');
        }
        disableTags += 1;
        renderChildren(node);
        disableTags -= 1;
        if (disableTags === 0) {
          if (node.title) {
            lit('" title="' + escapeXml(node.title));
          }
          lit('" />');
        }
        break;
      }
      case 'document':
        renderChildren(node);
        break;
      case 'paragraph': {
        // 紧列表里的段落：不加 <p> 标签，仅渲染内容
        const grandparent = node.parent?.parent ?? null;
        if (grandparent !== null && grandparent.type === 'list' && grandparent.listData?.tight) {
          renderChildren(node);
          break;
        }
        cr();
        tag('p');
        renderChildren(node);
        tag('/p');
        cr();
        break;
      }
      case 'heading': {
        cr();
        tag('h' + node.level);
        renderChildren(node);
        tag('/h' + node.level);
        cr();
        break;
      }
      case 'code_block': {
        let cls = '';
        if (node.info !== null && node.info !== '') {
          const firstWord = node.info.split(/\s+/)[0] ?? '';
          if (firstWord.length > 0) {
            const escaped = escapeXml(firstWord);
            cls = /^language-/.test(escaped) ? escaped : 'language-' + escaped;
          }
        }
        cr();
        tag('pre');
        tag('code', cls !== '' ? [['class', cls]] : []);
        out(node.literal ?? '');
        tag('/code');
        tag('/pre');
        cr();
        break;
      }
      case 'html_block':
        cr();
        lit(node.literal ?? '');
        cr();
        break;
      case 'thematic_break':
        cr();
        tag('hr', [], true);
        cr();
        break;
      case 'block_quote':
        cr();
        tag('blockquote');
        cr();
        renderChildren(node);
        cr();
        tag('/blockquote');
        cr();
        break;
      case 'list': {
        const tagname = node.listData!.type === 'bullet' ? 'ul' : 'ol';
        const start = node.listData!.start;
        const attrs: Array<[string, string]> =
          tagname === 'ol' && start !== undefined && start !== 1
            ? [['start', String(start)]]
            : [];
        cr();
        tag(tagname, attrs);
        cr();
        renderChildren(node);
        cr();
        tag('/' + tagname);
        cr();
        break;
      }
      case 'item': {
        tag('li');
        renderChildren(node);
        tag('/li');
        cr();
        break;
      }
      default:
        break;
    }
  };

  renderNode(root);
  return buffer;
}
