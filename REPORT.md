# REPORT · A-08 CommonMark 解析器（commonmark-ts）

> 工程目录 `C:\works\commonmark-ts`，项目名 `commonmark-ts`；Web：`commonmark-lab`（已部署 https://commonmark-lab.pages.dev ）。
> oracle：官方 CommonMark 0.31.2 规范测试集（commonmark-spec）+ devDependency `commonmark` 0.31.2（参考实现）。
> 本项目是任务书里唯一有官方逐例测试集的语言类项目——652 例全过是定义性验收，已达成。

## 一、开工前体检

1. **spec.txt 可达**：`commonmark-spec@0.31.2` 包内 spec.txt 共 9756 行，工程内可达 ✓
   （与任务书"已验证可达"一致）。
2. **例数核实**：任务书猜提取围栏是 14 个反引号，实际是 **32 个**；按任意长度反引号围栏自适应提取，
   共 652 例 ✓（与任务书例数一致）。
3. **tab 约定**：spec.txt 用 `→`（U+2192）表示示例中的真实制表符（规范前言约定），提取时还原为 `\t`。
4. **提取口径 oracle 自检**：提取出的期望 HTML 与参考实现逐字符对拍 **652/652 一致**——提取器口径零误差。
5. **oracle 就位**：`commonmark@0.31.2` 渲染探针正常。
6. **实体表**：oracle 运行时数据源 `entities@~3.0.1` 的 HTML5 实体表（2125 条），用生成脚本
   `scripts/gen-entities.mjs` 读其数据文件生成 `src/entities.ts`（只取标准数据，不含 oracle 逻辑）。
7. **任务书 vs 现实**：除围栏长度描述偏差外无冲突；范围边界（GFM 不做）确认。

## 二、实现决策

**架构**：纯 TS、零 npm 运行时依赖，两阶段解析：

- **块级 `src/blocks.ts`**：行驱动算法（规范附录 A）——每行先自上而下尝试延续已打开的容器块，
  再自左而右按优先级尝试 8 类块起始（引用 / ATX / 围栏 / HTML 七类 / Setext / 主题分隔 / 列表 / 缩进代码），
  最后把剩余文本交给最深可接受文本的块。惰性续行、空行归属、列表松紧判定、LRD 剥离时机（文档收尾从段首剥离；
  Setext 转换前先剥离）都在这条主循环里。Tab 按列数推进制展开（4 列制表位），内容保留原字符。
- **内联 `src/inlines.ts`**：单趟扫描 + delimiter 栈：code span（等长反引号条带）、反斜杠转义、
  HTML5 实体（名称区分大小写精确匹配；数字引用 0/越界/代理区 → U+FFFD）、强调 17 条规则
  （delimiter run 左右缘合性分类 + 下划线词内限制 + odd_match 三倍长规则 + openers_bottom 搜索下界）、
  链接三形态（内联 / 全量·折叠·简写引用）、图片、自动链接、原始 HTML tag 语法。
- **HTML 渲染 `src/render-html.ts`**：cr()/lit() 条件换行模型，紧/松列表、img alt 屏蔽标签、
  URL 先编码再转义。
- **Markdown 序列化器 `src/render-md.ts`**：AST → Markdown（round-trip 用）——文本全标点反斜杠转义、
  边缘空白实体化（含 NBSP 等 trim 会剥的 Unicode 空白）、强调嵌套换字符定界符（感知内层类型防粘连）。
  仅保证对"可从 CommonMark 解析得到的 AST"可逆。
- **`src/entities.ts`**（生成）：2125 条 HTML5 实体表。
- 公开 API 按任务书：`parseBlocks` / `parseInlines` / `renderHtml(src, { smart })`。

**与 oracle 的语义裁决记录**（规范含糊处读 oracle 源码定位语义后自行实现，未复制代码）：

- odd_match 与 openers_bottom 键都使用 **origdelims**（原始 run 长度），不是剩余长度
- opener.index 存 `[` 的位置（引用标签原文含方括号，归一化时剥去）
- `normalizeReference`：trim + 空白折叠 + toLowerCase→toUpperCase 双重折叠（覆盖 ẞ→SS）
- URL 编码：保留 `A-Za-z0-9` 与 `!$&'()*+,;=:@/?#-._~`，已有合法 %XX 原样保留，其余按 UTF-8 百分号编码
- item/list finalize 时结束行取最后一个子块的结束行——这是块间空行判定（松紧判定）的依据
- HTML 块类型 7 的惰性豁免条件；类型 6/7"前导空格属于块内容"的细节
- 序列化器强调定界符：`*`+内层 emph 粘连 → 换 `_`；`**`+内层 emph 或任何 `_` 粘连 → 换 `__`
  （`*`+内层 strong 粘连恰好解析回正确结构，保留 `*`）

## 三、验收清单对照

| 验收项 | 要求 | 实际 | 结果 |
|---|---|---|---|
| `npm run typecheck` | 全绿 | 全绿 | ✅ |
| `npm test` | 全绿 | 1318/1318（652 spec + 652 round-trip + fuzz/差分/API/smoke） | ✅ |
| 官方 652 例 | 100% | **652/652**（首轮 603，仅一处括号位置 off-by-one，修复后全过） | ✅ |
| fuzz 5000 条 | 不崩、确定性 | 5000 条不崩、两次渲染逐字符相等（固定种子 20241121） | ✅ |
| 参考实现三角差分 | 一致 | 652 例 + fuzz 5000 条 + smart 抽样，**零差分** | ✅ |
| AST round-trip | 500 例 | **652/652 全过**（超额） | ✅ |
| Web UI 单文件部署 | commonmark-lab | https://commonmark-lab.pages.dev （71 KB 单文件） | ✅ |
| REPORT.md | 完整 | 本文件 | ✅ |

调试基础设施：`scripts/diff-check.ts`（652 例差分查看器）与 `scripts/rt-check.ts`（round-trip 查看器），
esbuild 打包到 `.tmp/` 运行（不入库）。

## 四、已知限制

1. **序列化器仅对"可解析 AST"可逆**：printMarkdown 只保证"解析得到的 AST → 打印 → 再解析 → AST 相等"
   （652 例全过验证）。手造不可解析的 AST 可能不可逆，这是设计口径而非缺陷。
2. **序列化器强调定界符规则**按 652 例全形态验证；更深层嵌套（如 strong(strong(emph)) 前后有标点邻接等
   极端组合）的定界符选择可能选错——已记录为序列化器局限，不影响解析与 HTML 渲染。
3. **JS `\s` 比规范 Unicode whitespace 略宽**（多覆盖 `\v` `\f` `\ufeff`）：与 oracle 行为一致
   （oracle 同用 JS `\s`），对拍无影响；理论规范偏差与 oracle 同款，按 oracle 口径不单独处理。
4. **smart 引号**与强调 delimiter 同栈处理，做了抽样差分一致；未做全语料 smart 差分。
5. 多行 title 的链接在容器内打印时用 `&#10;` 实体保持结构正确，但该形态依赖"可达 AST"前提（见限制 1）。

## 五、博客素材要点

1. **"规范即测试集"**：CommonMark 的每个示例就是断言，652 例全过 = 语言级验收。提取口径本身可以
   用 oracle 自检证明正确（提取的期望 HTML 与参考实现逐字符一致 652/652）——"你的提取器对不对，
   oracle 自己就能证明"是个漂亮的写作点。
2. **强调算法是整道题的灵魂**：规则 1-8 是 delimiter run 分类（左右缘合性 4 象限 + 下划线词内限制），
   规则 9-17 是配对过程：找第一个能闭合的定界符 → 回找 opener（odd_match：和为 3 的倍数且非双方皆 3 的倍数
   则跳过）→ openers_bottom 缓存搜索下界 → 配对成功"收拢中间节点"。写错时强调相关 60+ 例集体扑街，
   辨识度极高。
3. **"603 → 652 只修了一个 off-by-one"**：首轮全量对拍 603/652，所有失败集中在一个根因——引用标签
   位置的 off-by-one（opener.index 存 `[` 还是 `[` 后一位）。修一行全过。"almost right" 和 "right"
   之间只隔一个字符，这是最好的博客叙事钩子。
4. **两阶段解析的哲学**：块级是行驱动（continue / 块起始优先级 / 惰性续行），内联是 delimiter 栈；
   块结构优先于内联结构是 CommonMark 的核心设计（规范 "Precedence" 节）。
5. **round-trip 的"谁吃掉谁"**：AST 打印 → 再解析 → AST 相等，看起来简单，实际全是空白会被谁吃掉的细节：
   行首空格被块级缩进吃、NBSP 被 trim 吃、text 里的 `\n` 是实体不是软换行、强调嵌套粘连 `***`、
   `- ---` 整行会被读成主题分隔——五个坑各是一个故事点。
6. **部署即 demo**：https://commonmark-lab.pages.dev 左编辑右预览，附 HTML/AST/重打印检视，
   解析器跑在浏览器里（71 KB 单文件）；博客可用它做 delimiter run 规则的可视化教学素材。
7. **零依赖的代价与回报**：零运行时依赖意味着每个词法细节都要自己扛；回报是三角差分零差分——
   手写实现与参考实现在 5652 个输入上行为可互换（652 规范例 + 5000 fuzz）。

