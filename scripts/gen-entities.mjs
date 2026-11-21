// 生成 src/entities.ts：HTML5 命名实体表（CommonMark 规范 6.x 明确引用的 HTML5 数据表）。
// 数据来源：devDependency `entities`（与 oracle commonmark 0.31.2 运行时用的是同一份 HTML5 数据），
// 只取其数据 map，不含任何 oracle 逻辑；生成脚本入库，可复现。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../src/', import.meta.url), { recursive: true });
// 与 oracle（commonmark 0.31.2 → entities ~3.0.1）同一份 HTML5 数据表；
// npm 去重后可能在顶层或嵌套目录，两处都试。
const mapCandidates = [
  new URL('../node_modules/entities/lib/maps/entities.json', import.meta.url),
  new URL('../node_modules/commonmark/node_modules/entities/lib/maps/entities.json', import.meta.url),
];
const mapPath = mapCandidates.find((p) => existsSync(p));
if (!mapPath) throw new Error('找不到 entities 数据表（entities@~3.0.1 应已随 devDeps 安装）');
const entities = JSON.parse(readFileSync(mapPath, 'utf8'));

const names = Object.keys(entities);
if (names.length < 2000) throw new Error('实体表异常：条目数 ' + names.length);

// 生成 TS 字符串字面量（JSON.stringify 可处理控制字符与引号）
const rows = names
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(entities[k])},`)
  .join('\n');

const ts = `// 本文件由 scripts/gen-entities.mjs 生成，勿手改。
// 数据：HTML5 命名实体表（CommonMark 规范引用的 HTML5 标准数据；与 WHATWG entities.json 同源）。
// 共 ${names.length} 条，键不含 & 与 ;。
export const ENTITIES: Record<string, string> = {
${rows}
};
`;
writeFileSync(new URL('../src/entities.ts', import.meta.url), ts, 'utf8');
console.log(`生成 src/entities.ts：${names.length} 条实体`);
