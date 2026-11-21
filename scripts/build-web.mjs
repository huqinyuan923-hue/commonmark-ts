// Web 单文件构建：esbuild 打包 web/main.ts → 内联进 web/index.html → dist/web/index.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await build({
  entryPoints: ['web/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  logLevel: 'error',
});

const js = result.outputFiles[0].text;
const template = readFileSync('web/index.html', 'utf8');
// 内联脚本（避免 </script> 截断问题）
const safeJs = js.replace(/<\/script>/g, '<\\/script>');
const html = template.replace('/*__BUNDLE__*/', () => safeJs);

mkdirSync('dist/web', { recursive: true });
writeFileSync('dist/web/index.html', html, 'utf8');
console.log(`dist/web/index.html 构建完成：${(html.length / 1024).toFixed(1)} KB`);
