// AST 节点定义与树工具。
// 公开接口见 index.ts 的 Node；这里是解析期内部节点（带树结构与解析态字段），
// 导出时经 toPublicNode() 收敛成任务书规定的 { type, children?, literal?, attrs? } 形状。

export interface RefEntry {
  dest: string;
  title: string;
}

export interface ListData {
  type: 'bullet' | 'ordered';
  tight: boolean;
  bulletChar?: string;
  start?: number;
  delim?: string;
  padding: number;
  markerOffset: number;
}

export class MdNode {
  type: string;
  children: MdNode[] = [];
  literal: string | null = null;
  parent: MdNode | null = null;
  // —— 解析期内部字段（不出现在公开 AST）——
  open = false;
  stringContent = '';
  startLine = 0;
  endLine = 0;
  level = 0; // heading
  info: string | null = null; // 围栏代码块 info string（已反转义）
  htmlBlockType = 0;
  isFenced = false;
  fenceChar = '';
  fenceLength = 0;
  fenceOffset = 0;
  listData: ListData | null = null;
  destination: string | null = null; // link / image
  title: string | null = null;

  constructor(type: string) {
    this.type = type;
  }

  appendChild(child: MdNode): void {
    child.unlink(); // 先脱离旧父（新节点此步为空操作）
    child.parent = this;
    this.children.push(child);
  }

  /** 从父节点摘下（无父则跳过） */
  unlink(): void {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
      this.parent = null;
    }
  }

  /** 在自身之后插入兄弟节点 */
  insertAfter(node: MdNode): void {
    const p = this.parent;
    if (!p) throw new Error('insertAfter：节点无父');
    const idx = p.children.indexOf(this);
    node.unlink();
    p.children.splice(idx + 1, 0, node);
    node.parent = p;
  }

  get lastChild(): MdNode | null {
    return this.children.length > 0 ? this.children[this.children.length - 1]! : null;
  }

  get firstChild(): MdNode | null {
    return this.children.length > 0 ? this.children[0]! : null;
  }

  /** 下一个兄弟节点 */
  next(): MdNode | null {
    if (this.parent === null) return null;
    const idx = this.parent.children.indexOf(this);
    return idx >= 0 && idx + 1 < this.parent.children.length ? this.parent.children[idx + 1]! : null;
  }
}

/** 深比较两棵 AST（type / literal / level / info / listData 语义字段 / destination / title / children） */
export function astEquals(a: MdNode, b: MdNode): boolean {
  if (a.type !== b.type) return false;
  if ((a.literal ?? null) !== (b.literal ?? null)) return false;
  if (a.type === 'heading' && a.level !== b.level) return false;
  if (a.type === 'code_block') {
    if ((a.info ?? null) !== (b.info ?? null)) return false;
    if (a.isFenced !== b.isFenced) return false;
  }
  if (a.type === 'list' && a.listData && b.listData) {
    if (
      a.listData.type !== b.listData.type ||
      a.listData.tight !== b.listData.tight ||
      (a.listData.bulletChar ?? null) !== (b.listData.bulletChar ?? null) ||
      (a.listData.start ?? null) !== (b.listData.start ?? null) ||
      (a.listData.delim ?? null) !== (b.listData.delim ?? null)
    ) {
      return false;
    }
  }
  if (a.type === 'link' || a.type === 'image') {
    if ((a.destination ?? null) !== (b.destination ?? null)) return false;
    if ((a.title ?? null) !== (b.title ?? null)) return false;
  }
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!astEquals(a.children[i]!, b.children[i]!)) return false;
  }
  return true;
}

/** AST 的规范文本打印（调试与测试诊断用） */
export function printAst(node: MdNode, indent = 0): string {
  const pad = '  '.repeat(indent);
  let line = pad + node.type;
  const extras: string[] = [];
  if (node.literal !== null) extras.push('literal=' + JSON.stringify(node.literal));
  if (node.type === 'heading') extras.push('level=' + node.level);
  if (node.type === 'code_block' && node.info) extras.push('info=' + JSON.stringify(node.info));
  if (node.destination !== null) extras.push('dest=' + JSON.stringify(node.destination));
  if (node.title !== null && node.title !== '') extras.push('title=' + JSON.stringify(node.title));
  if (node.listData) {
    extras.push(
      `list(${node.listData.type},tight=${node.listData.tight},start=${node.listData.start ?? ''},delim=${node.listData.delim ?? ''},marker=${node.listData.bulletChar ?? ''})`,
    );
  }
  if (extras.length > 0) line += ' (' + extras.join(', ') + ')';
  return line + '\n' + node.children.map((c) => printAst(c, indent + 1)).join('');
}
