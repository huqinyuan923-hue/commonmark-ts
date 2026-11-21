// 反转义与规范化工具：反斜杠转义、实体引用、数字字符引用、URL 编码、引用标签归一化。
import { ENTITIES } from './entities.js';

// 可转义的 ASCII 标点（规范 2.4：! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~）
export const ESCAPABLE = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/;

// 实体引用（命名 2-32 字符、十进制 1-7 位、十六进制 1-6 位；分号必需）
export const ENTITY_SRC =
  '&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});';
// 转义或实体（用于反转义字符串）
const reEntityOrEscapedChar = new RegExp(
  '\\\\' + ESCAPABLE.source + '|' + ENTITY_SRC,
  'gi',
);

/** 数字字符引用解码：0 / 越界 / 代理区 → U+FFFD */
function decodeNumeric(hex: boolean, digits: string): string {
  const cp = parseInt(digits, hex ? 16 : 10);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return '\uFFFD';
  }
  return String.fromCodePoint(cp);
}

/** 单个转义或实体片段解码 */
function decodeOne(m: string): string {
  if (m.charCodeAt(0) === 0x5c /* \ */) {
    return m.charAt(1);
  }
  const body = m.slice(1, -1);
  if (body.charCodeAt(0) === 0x23 /* # */) {
    if (body.charAt(1) === 'x' || body.charAt(1) === 'X') {
      return decodeNumeric(true, body.slice(2));
    }
    return decodeNumeric(false, body.slice(1));
  }
  // 命名实体：按精确键查 HTML5 表（实体名区分大小写，Aacute 与 aacute 是不同实体）；
  // 未命中（表里没有该名字）就原样返回
  return ENTITIES[body] ?? m;
}

/** 反转义字符串（链接目的地/标题/info string 用）：反斜杠转义 + 实体引用 */
export function unescapeString(s: string): string {
  if (!/[\\&]/.test(s)) return s;
  return s.replace(reEntityOrEscapedChar, decodeOne);
}

/**
 * URL 编码（渲染 href/src 用）：
 * 保留 A-Za-z0-9 与 -._~!$&'()*+,;=:@/?#；已有合法 %XX 序列原样保留；
 * 其余字符按 UTF-8 百分号编码（大写十六进制）。
 */
const URL_KEEP = /[A-Za-z0-9\-._~!$&'()*+,;=:@/?#]/;
const HEX = /[0-9a-fA-F]/;

export function encodeUrl(s: string): string {
  const bytes: number[] = [];
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '%' && HEX.test(s[i + 1] ?? '') && HEX.test(s[i + 2] ?? '')) {
      // 已有合法 %XX 序列，原样保留
      out += s.slice(i, i + 3);
      i += 3;
      continue;
    }
    if (URL_KEEP.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    // 其余字符：UTF-8 字节逐个百分号编码
    bytes.length = 0;
    for (const b of new TextEncoder().encode(ch)) bytes.push(b);
    for (const b of bytes) {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    i += 1;
  }
  return out;
}

/**
 * 引用标签归一化（规范 6.6）：去方括号、trim、连续空白折叠成单空格、Unicode 大小写折叠。
 * 折叠用 toLowerCase().toUpperCase() 两步法覆盖 ẞ→SS 这类特例（与规范大小写折叠等价的
 * 常用近似，oracle 同款做法）。
 */
export function normalizeReference(labelWithBrackets: string): string {
  return labelWithBrackets
    .slice(1, labelWithBrackets.length - 1)
    .trim()
    .replace(/[ \t\r\n]+/g, ' ')
    .toLowerCase()
    .toUpperCase();
}
