# Syntax Palette：AI 开发交接文档

> 首次公开发布前，项目正式身份已更新为 **Syntax Palette**（plugin ID `syntax-palette`）。此前的 `Atom One Fenced Syntax` / `atom-one-fenced-syntax` 仅是未发布开发身份；Obsidian 按 ID 存储设置，旧 ID 的 `data.json` 不会自动迁移。历史章节保留旧名称以准确记录当时版本。

## 接手必读：v0.5.2 桌面专用版本

当前版本为 **0.5.2**。支持目标是 macOS、Windows、Linux 桌面版 Obsidian；iOS、iPadOS、Android 不再支持。源码构建生成的 manifest 均须设置 `isDesktopOnly: true`。具体哪些系统通过本轮验收，见 `V0.5.2-SUMMARY.md`，不可由一个平台的结果推断其他平台通过。

本版只取消移动端支持并清理专属平台判断：移除了 `Platform.isMobile` 状态和诊断报告中的移动端分类；窄视口检查继续保留为 `mobile: false` 的桌面窗口布局/压力回归。无 CSS Custom Highlight API 时的兼容渲染是通用能力，旧桌面 WebView 仍可能需要，保留。WASM 仍通过 Obsidian Vault adapter 的 `readBinary()` 加载；主题来源数据、渲染缓存、行号性能优化、行号/自动换行及 `editor-scroll.cjs` 的代码块独立横向滚动均须保留。

v0.5.1 的横滚隔离修复不可回退：滚动宽度通过 CodeMirror 行装饰引用块级共享变量；不要改回逐行测量后写宽度。同步循环只写变化的偏移，不读取布局几何。横滚状态按代码块隔离；正文和其他块不得跟随移动。见 `V0.5.1-SUMMARY.md` 与 `evidence/v0.5.1/`。

原 v0.5.2 验证与交付证据写入 `evidence/v0.5.2/`，当时产物使用旧开发身份。当前根目录 `manifest.json` 是新 ID/名称的唯一来源；构建产物将生成到 `plugin/syntax-palette/`，打包文件为 `syntax-palette-0.5.2.zip`。只使用 `/tmp` 隔离 Obsidian Vault/profile，不修改用户 Vault、笔记或插件设置；本仓库仍未公开，也没有提交社区商店。

路径审查：插件运行时与安装包不含 macOS 绝对路径；WASM 使用 `app.vault.adapter.readBinary()`。`tools/obsidian-v0.4.0-test.cjs` 的应用启动路径默认值为 macOS，但可由 `AOF_OBSIDIAN_BIN` 覆盖，Windows/Linux 尚未验证该启动器。更早的纯 CSS 验收与 DevTools 审计脚本仍保留在本机 checkout，但因含工作区/Vault 路径且可能操作活动窗口，已由 `.gitignore` 排除，不属于当前构建或回归入口；不要用它们运行跨平台验收，也不要对真实 Vault 运行旧审计脚本。

以下保留 v0.5.1 和更早版本的技术历史：**v0.5.0（行号滚动性能 + 编辑视图代码块自动换行）**曾沿用 0.4.0 的移动端适配工作；移动端相关记载仅说明旧版本历史，不是当前支持声明。

更完整的需求、实现和测试细节见 `TECH-REQUIREMENTS-HANDOFF-v0.4.0.md`；本文是接手时先读的总览。v0.3.0 的历史见 `TECH-REQUIREMENTS-HANDOFF-v0.3.0.md`、`V0.3.0-SUMMARY.md`、`evidence/v0.3.0/`；v0.2.0 及更早见 `TECH-REQUIREMENTS-HANDOFF-v0.2.0.md`、`V0.2.0-SUMMARY.md`、`evidence/v0.2.0/`。

## 0. 历史：v0.5.0 状态（横滚结论已撤回）

- **0.5.0 的新增功能**：设置项 **「编辑视图代码块自动换行」**（`wrapCodeBlocks`，默认 `false`）。
  关闭时编辑视图围栏代码行不换行、超长行单行 + 横向滚动；开启时恢复 Obsidian 原生换行。
  只作用于代码块，普通 Markdown 行始终原生换行；**阅读视图完全不受影响**。
  改动立即生效（`refreshEffect` 重下发 `Decoration.line`），持久化，卸载 / 关闭开关时
  生成样式为空串 → 原生行为原样恢复。
- **为什么不用 `EditorView.lineWrapping`**：那是全局 facet，会关掉整个编辑器的换行。
  实现是「按行 `aof-nowrap` 类 + `white-space: pre`（可继承，只覆盖该行）+
  `.cm-scroller { overflow-x: auto }`」。`pre` 不能用 `nowrap` 代替：后者合并连续空格、
  丢缩进。CSS 在 `plugin-src/wrap-style.cjs`，开关开时返回空串。
- **0.5.0 修的是 0.4.4 没修干净的行号滚动卡顿**。0.4.4 的「27 → 0 次重测」只覆盖
  「rescan 不再无条件调度几何」这一条路径，它数的是「有没有排重测」，不是「花了多少
  主线程时间」。**受控 A/B（390×844、连续三次手势下→上→下、每次 40 帧 × 180px）**：

  | 行号开，三次手势合计 | 0.4.4 | 0.5.0 |
  | --- | --- | --- |
  | `measureReadingLineNumbers` 次数 | 6（每手势 2） | 6（每手势 2） |
  | 阅读插件**总耗时** | **38.6ms** | **3.9ms** |
  | 单次向下手势的测量耗时 | 14.8ms / 15.3ms | 0.3ms 量级 |
  | `applyReadingLineNumbers`（重新编号） | **18**（上滚 14） | **10**（上滚 8） |
  | `<style>` 重写 | 0 | 0 |
  | 编辑视图插件总耗时 | 1.1ms | 0.1ms |

  结论：**测量次数本来就不多，贵的是每次测量都重算全部块**（`getComputedStyle` +
  `offsetTop` 强制同步布局）。修复：增量测量（只测无测量值 / 在队列里的块）、按帧合并、
  一次性重检（不自排）、`markReadingFences` 每块记忆、`rebuildStyle` 走 `styleDirty`、
  `visibleCodeLines` 改 O(可见)。
- **两条不可回退的判据**：
  1. `measureReadingLineNumbers` **不得**每次遍历全部块；只有「在重测队列」或
     「无测量值」的块可参与。重检必须 `recheck: true` 且**不得再排重检** ——
     否则形成每帧一次测量的自激循环（实测 40 帧手势 76 次，比修复前更差）。
  2. `readingPreMemo` 命中前**必须校验 DOM 类**（`aof-ln-on` / `aof-fenced-block`）。
     只看记忆会让「行号关掉再打开」后的第一个代码块永久不编号 —— 这是 0.5.0
     自己引入又修掉的回归，`clearReadingLineNumbers()` 同时删除该块记忆。
- **换行与行号的几何契约**：编号来自 `blockNumberRows`（逻辑行），与视觉行数无关；
  数字是 `.cm-line::before` 的生成内容，`position:absolute; top:0`，永远贴该逻辑行的
  **第一条视觉行**；栏宽是纯 CSS `calc(inset + Nch + gap)`，四种组合下 `padding-left`
  必须完全相等（实测 40.65px）。断言用渲染盒（高度 / `scrollLeft` 读回值 / `::before`
  计算值），不看 CSS 文本。
- **测试栈（0.5.0）**：单元 **76** 项（`npm run verify`，含新增 `wrap-style.test.cjs`）；
  WKWebView 高亮 9 项 + 行号 / 几何 13 项；隔离 Obsidian **25 阶段**
  `AOF_EVIDENCE=evidence/v0.5.0 npm run test:obsidian`，新增
  `wrapCombinations`（四组合 + 阅读对照 + 持久化）与 `scrollCost`（滚动开销硬阈值）。
  `settingsUI` / `commandModal` / `lineNumbersSettings` 的开关数量断言已从 3 改为 4。
- **性能基线（0.5.0，390×844 手机尺寸、连续三次手势）**：阅读 measure 6 次（每手势 2）、
  插件总耗时 **2.9–3.9ms**（0.4.4 为 38.6ms；3.9 为 A/B 轮、2.9 为最终完整套件复跑）、
  重新编号 10 次（0.4.4 为 18）、样式重写 0 次；
  编辑 0 次阅读测量、插件总耗时 0.1–0.2ms、样式重写 0 次。最大帧间隔**不作判据**
  （桌面模拟下两版同处 41–77ms 区间，受合成器与 GC 影响）。
- 证据：`evidence/v0.5.0/`（`real-obsidian-results.json`、`diagnosis.md`、
  `mobile-scroll-probe.json` 为 0.4.4 基线、`wrap-on.png` / `wrap-off.png` 对比图）。
- **结论分级**：开发完成 ✅ / 桌面 Chromium 移动端模拟 + WKWebView 同源引擎验证 ✅ /
  **真实 iPhone / iPad / Android ❌ 未验证**。真机待验：滚动流畅度、代码块内竖滑是否
  被横向滚动截获、iOS overlay 滚动条与惯性。

### 0.1 历史：v0.4.4 状态（细节仍有效）

- **0.4.4 修的是 0.4.3 真机暴露的两个问题**：
  1. **关闭行号后主题失效、必须重启** —— 任意设置变更都会先清空编辑器高亮 ranges，再靠一次**异步** `requestMeasure` 重建；该请求可被 CodeMirror 合并 / 吞掉，一旦被吞就永久丢色。清空时还会把最后一个 range 的 palette 从 `CSS.highlights` 删除，`rebuildStyle()` 生成空 CSS。修复：`updateSettings()` 计算 `themeChanged`（light / dark / coloredBrackets），只有换主题才 `setThemes` + `resetPalettes()` + 逐块重应用；行号 / 背景开关只做布局；`clearRanges()` 不再删 palette（只有 `resetPalettes()` 会）；`rebuildStyle()` 无变化不写；写入阶段原子替换（先 drop 后 add）。**判据：行号 off→on→off→on 后 `editorRanges` 计数、高亮 CSS 长度 / 规则数、palette 数全部不变**（23 阶段套件的 `highlightStability` 阶段固化）。
  2. **开行号滚动卡顿 / 闪顿（编辑 + 阅读）** —— 三处独立开销：
     - **全量重建 + `<style>` 重写**（0.4.3 基线）：每个 update 重建全部 ranges 并重写整个样式节点。修复：**按行增量重建** —— `builtLines: Map<lineNo, 已建 range 数>`，只为新露出 / 失效的行建 range，行卸载后剪枝；`rebuildStyle()` 内容不变不写。**重建判据是覆盖**（每个可见代码行必须有活 range）+ `syntaxTree` 变化 + 断连检测 —— 早期只看「可见块集合 + isConnected」的版本在单个高块内滚动会漏掉新行（探针实测 26–82 行丢色），**不能回退到那种判据**。DOM 映射失败的行重试 5 次后放弃，防止死循环。
     - **编辑行号是 CodeMirror widget**：每行滚入都要测量挂载、数字晚一帧出现（"闪一下"）。修复：行号改为 `Decoration.line` 的 `data-aof-n` 属性 + CSS `::before` 生成内容（与阅读视图同机制）；`::before` 非 DOM 文本，不参与复制 / 编辑，也不可能被 `::highlight()` 染色。引用块 / 列表内的行号仍用内联 widget（数字必须在 `> ` / `- ` 标记之后）。**判据：WKWebView / 隔离 Obsidian 中 `getComputedStyle(line, '::before')` 解析出真实像素盒，行号到代码间距 = 栏间距，挂载位移 0。**
     - **阅读视图滚动时行号几何被反复重测**（"顿一下"，只在行号开时）：预览容器观察者监听 `class` 属性，滚动时宿主 class 抖动（一个手势 20+ 次）→ rescan → **无条件** `scheduleReadingLineNumberGeometry()`（每个 `<pre>` 一次 `getComputedStyle` + 写 CSS 变量）。实测一个滚动触发 26 次 rescan + 27 次几何重测。修复：容器观察者只看 `childList`（重渲染换节点；文本变化由 `colorReading` 逐块观察者覆盖）；rescan 不再无条件调度几何（`applyReadingLineNumbers` 在缺测量时自调度，宽度 / 主题变化由 relayout 负责）；`relayoutLineNumbers` 签名只看 `innerWidth`（移动端工具栏收放只改高度，不需重测）。**判据：同一滚动下 `measureReadingLineNumbers` 次数为 0，行号开 / 关单步开销一致。**
- **0.4.1 的高亮修复不可回退**：`plugin-src/highlight-style.cjs` 的 `selectorsFor()` 后代形式必须是 `host :not(.aof-ln)::highlight(name)`，删掉后代形式 iOS 整块不上色；用裸 `*` iOS 行号会被染色。0.4.4 后编辑行号是 `::before`（机制上不可染色），但 `:not(.aof-ln)` 仍要保留给引用块 / 列表的内联行号组件。
- **0.4.3 的几何约定仍是底线**：阅读栏宽 = `calc(inset + --aof-ln-digits × 1ch + gap)` 纯 CSS；`GUTTER_GAP = 1.3em`（清除折叠角标 15px）；不得回退为测量像素栏宽或先清空再重测。
- **测试栈（0.4.4 当时；0.5.0 已扩到 76 单元 / 25 阶段）**：单元 70 项（`npm run verify`）；WKWebView `npm run test:webkit`（9 项高亮取色）+ `npm run test:webkit:ln`（13 项行号 / 几何）；隔离 Obsidian 23 阶段 `AOF_EVIDENCE=evidence/v0.4.4 npm run test:obsidian`（vault `/tmp/aof-v040-test`、profile `/tmp/aof-v040-profile`、CDP 9333，含新增 `highlightStability`）。单阶段通过 ≠ full run 通过，断言要带轮询与诊断。
- **性能基线**（160 行块、60 步 × 48px 滚动）：编辑单步 p95 14.4ms（行号开）/ 12.9ms（关），阅读 0.2ms 且开 / 关一致；滚动全程 `<style>` 重写 0 次；覆盖探针 8 个位置 0 缺失（探针必须自证滚动生效，否则视为无效）。
- 证据：`evidence/v0.4.4/`（diagnosis.md、real-obsidian-results.json、webkit-*）、`V0.4.4-SUMMARY.md`。**结论分级：开发完成 / 模拟环境验证 ✅；真实 iPhone / iPad / Android ❌ 未验证**，真机手感须装包自检，不得与模拟结论混写。
- 仍未验证：真实移动设备、Windows、pop-out；只做 TextMate，不做 LSP/语义 Token；社区商店未发布。
- 旧开发身份曾有重复插件目录的历史记录。该记录只适用于旧 ID 的本地开发环境；迁移到 `syntax-palette` 前应备份旧 `data.json`，不要同时启用旧版和新版。本次仓库准备没有读取或修改任何 Vault、笔记或插件设置。

## 1. 产品不可擅自改变的需求

允许改变的笔记内容：

1. 围栏代码内部语法 Token 的 `color`；
2. 围栏代码块正常文字的 `color`（仍通过 Token 前景色）；
3. **背景开关开启时**，围栏代码块的 `background-color`；
4. **行号开关开启时**，代码块左侧的只读编号（编辑器零长度 widget / 阅读模式生成内容）；
5. **自动换行开关关闭时（默认）**，编辑视图围栏代码行的换行方式：该行 `white-space: pre`
   由 `aof-nowrap` 类限定，并允许 `.cm-scroller` 横向滚动。只作用于带该类的代码行，
   普通 Markdown 行保持 Obsidian 原生换行；正文、行内代码、缩进代码一律不碰。

禁止改变：

- Markdown 正文、标题、引用、链接、行内代码；
- 缩进代码块；
- 字体、字号、字重、斜体、行高、字距；
- 边框、圆角、阴影、内外边距、布局、尺寸（**围栏代码行的换行布局除外**，见「允许改变」第 5 条：
  行号栏预留的 `padding-left` 与代码行 `white-space` 属于该条授权的范围，且必须保持四种
  开关组合下栏宽一致）；
- 围栏起止标记的文字样式；
- Obsidian 全局/编辑器背景、Minimal 文件/设置、其他插件及其配置；
- 用户笔记原文。

不得通过插入 span、克隆 DOM、修改 Markdown 或扩大 CSS 属性范围来模拟 VS Code 编辑器。

背景开关必须默认关闭，必须只使用当前生效浅/深主题同一变体的官方背景；主题缺少背景时安全回退到 Obsidian 原生背景。

## 2. 工作目录与关键文件

工作目录：

```text
<repo-root>
```

| 文件 | 职责 |
| --- | --- |
| `plugin-src/main.cjs` | 生命周期、设置页/命令弹窗、编辑高亮、背景行装饰、行号 widget、阅读背景/行号映射、几何测量、清理 |
| `plugin-src/engine.cjs` | TextMate 双 Registry、括号、回退、缓存 |
| `plugin-src/themes.cjs` | 主题目录、系列预设、安全选择 |
| `plugin-src/settings.cjs` | 默认值、规范化、补丁、升级兼容 |
| `plugin-src/highlight-style.cjs` | 只输出 `color` 的前景 CSS |
| `plugin-src/background-style.cjs` | 只输出 `background-color` 的浅深背景 CSS |
| `plugin-src/fences.cjs` | `fencedBlocks` / `allFencedBlocks` / `codeBlockTokens` |
| `plugin-src/line-numbers.cjs` | 纯函数编号规划、宽度分级、阅读编号 |
| `plugin-src/line-number-style.cjs` | 行号 CSS（关闭时输出空串） |
| `plugin-src/wrap-style.cjs` | v0.5.0：编辑视图换行 CSS（开关开时输出空串） |
| `plugin-src/assets/themes.json` | 39 变体，含 `foreground` / `background` / `tokenColors` |
| `plugin-src/styles.css` | 仅 `.aof-*` 的设置/预览样式 |
| `plugin-src/tests/` | 76 个 Node 测试（含行号、换行专项） |
| `sources/themes/sources.json` | 官方来源、版本、URL、VSIX 哈希、许可 |
| `sources/theme-provenance.json` | 源文件/许可证/归一化资产哈希和背景提取结果 |
| `tools/prepare-theme-assets.cjs` | JSONC/include 解析、前景/背景提取、生成资产与 provenance |
| `tools/build-plugin.cjs` | 打包 main.js、manifest、许可证、README、来源、SHA256SUMS |
| `tools/package-plugin.cjs` | 生成 ZIP + SHA-256 |
| `tools/verify-build.cjs` | 校验 39 主题、许可、哈希、路径、静态 CSS、换行规则、ZIP |
| `tools/obsidian-v0.4.0-test.cjs` | 隔离 Obsidian 25 阶段真实验收（v0.3.0 回归 + 行号 + 换行 + 窄屏 + 滚动开销 + 清理） |
| `tools/obsidian-v0.3.0-test.cjs` | v0.3.0 历史套件，保留 |
| `evidence/v0.5.0/` | **本次**证据：完整结果 JSON、诊断、0.4.4 基线探针、换行对比截图 |
| `evidence/v0.4.0/` | v0.4.0 证据：自动化、实机、截图、行号矩阵 fixture |
| `evidence/v0.3.0/` | v0.3.0 历史证据 |
| `PLUGIN-README.md` | 用户安装/使用/限制 |
| `THEME-PROVENANCE.md` | 用户可读主题来源/许可 |
| `V0.5.0-SUMMARY.md` | **本次**开发总结 |
| `V0.4.4-SUMMARY.md` | 上一版总结（行号丢色 / 卡顿修复） |
| `TECH-REQUIREMENTS-HANDOFF-v0.4.0.md` | 详细技术交接与需求追溯 |

历史/非运行依赖：`TECH-REQUIREMENTS-HANDOFF-v0.2.0.md`、`V0.2.0-SUMMARY.md`、`evidence/v0.2.0/`、`atom-one-syntax.css`、`CSS-README.md`。

## 3. 主题目录与来源

### 3.1 系列/变体

| 系列 | 浅色 | 深色 |
| --- | --- | --- |
| Atom One | Atom One Light | Atom One Dark |
| GitHub | GitHub Light Default | GitHub Dark Default、Dark Dimmed |
| Ayu | Ayu Light | Ayu Dark、Mirage |
| VS Code Official | Light+、Light Modern | Dark+、Dark Modern |
| Catppuccin | Latte | Frappé、Macchiato、Mocha |
| Dracula | — | Dracula Official |
| Tokyo Night | Tokyo Night Light | Tokyo Night、Storm |
| One Dark Pro | — | Pro、Darker、Flat |
| Night Owl | Light Owl（官方 label Night Owl Light） | Night Owl |
| Nord | — | Nord |
| Solarized | Solarized Light | Solarized Dark |
| Kanagawa | Lotus | Wave、Dragon |
| Material Theme | Lighter | Default、Darker、Palenight、Ocean |
| Monokai | — | Monokai |
| Min Theme | Min Light | Min Dark |

浅色 12、深色 27，共 39。没有为只有深色的官方系列虚构浅色。

### 3.2 来源/许可结论

- 官方 VSIX 发布资产：GitHub、Ayu、Catppuccin、Dracula、Tokyo Night 1.1.2、One Dark Pro 3.20.3、Night Owl 2.1.1、Nord 0.19.0、Solarized 3.0.0、Kanagawa Flavors 1.2.0、Material Theme 34.5.0、Min Theme 1.5.0。
- 官方内置：VS Code 1.142.0 的 Light+/Dark+/Light Modern/Dark Modern、Monokai。
- Atom One：akamud 官方主题快照 2.3.0。
- Solarized：Ryan Olson 的 MIT VS Code 移植版，不是原作者发布的 VS Code 包。
- Kanagawa：MIT 的 Kanagawa Flavors VS Code 移植版，署名 rebelot/Kanagawa.nvim。
- Material Theme：**仅 34.5.0 Apache-2.0**。34.7.x 改为限制性 Material Theme/Vira 条款，不得混入。
- One Dark Pro Flat 与 Pro 在本插件的前景色/背景上相同；仅因需求点名保留并公开说明。
- 未收录 Gruvbox、Rosé Pine、Everforest。

### 3.3 来源异常

- Tokyo Night Light 官方 JSON 的 `type` 误写为 `dark`，但官方注册 `uiTheme: "vs"` 且背景 `#E6E7ED`；归为浅色。
- Solarized Light 同样 JSON `type` 为 `dark`，但官方注册浅色且背景 `#FDF6E3`；归为浅色。

不要只看 JSON `type` 分类。`sources/theme-provenance.json` 记录了 `appearanceNote`。

### 3.4 背景提取

只提取同一个官方主题实例的 `colors.editor.background`。`tools/prepare-theme-assets.cjs` 会把无效/缺失记为 null；运行时该侧不生成背景规则，保留原生背景。当前 39 个都有有效背景。

## 4. 背景与行号实现要点（最容易坏的层）

### 4.1 数据与设置

`data.json`：

```json
{
  "light": "github-light-default",
  "dark": "tokyo-night-storm",
  "coloredBrackets": true,
  "codeBlockBackground": true,
  "lineNumbers": false
}
```

- 新键只在严格 `true` 时开启；缺失、字符串、数字都按关闭处理。
- 0.2.0 的旧键 `lightTheme` / `darkTheme` 仍兼容；0.3.0 的 `data.json` 缺少 `lineNumbers` → 关闭。
- 设置默认：Atom One Light / Dark、彩色括号开、背景关、行号关。
- 桌面与移动共用同一份 `data.json`，不新增移动专用键；Sync 不会因平台产生分叉。

### 4.2 背景 CSS

`background-style.cjs` 只生成 `background-color`，浅深各一组：

```css
.theme-light .markdown-rendered pre.aof-fenced-block,
.theme-light .markdown-rendered pre.aof-fenced-block > code,
.theme-light .markdown-source-view.mod-cm6 .cm-line.aof-fenced-line { background-color: #FFFFFF; }

.theme-dark ... { background-color: #24283B; }
```

- 只生成当前设置浅/深主题对应的规则。
- 关闭时 style 文本为空。
- 主题缺背景时对应方向不生成规则。
- 不使用背景图片、透明度、渐变、边框或字体属性。

### 4.3 编辑模式

- `ViewPlugin` 在文档变化时解析一次：
  - `allBlocks = allFencedBlocks(text)`；
  - `blocks = allBlocks.filter(b => b.language)` 供 TextMate。
- 背景开时，使用 `Decoration.line({class: 'aof-fenced-line'})` 覆盖每个围栏的起止行和内容行。
- 关闭背景时 `Decoration.none`；refresh effect 会移除类。
- 不添加 span。
- 空行有行装饰，滚动/编辑时随 CodeMirror 重绘，不会丢失。

### 4.4 阅读模式

阅读背景不使用 Prism 文本匹配。不要退回旧方案。

正确流程：

1. postprocessor 接收每个 `<pre>`。
2. `ctx.getSectionInfo(pre)` 得到完整文本和该代码块的 `lineStart/lineEnd`。
3. `readingTokensFor(section.text)` 解析 `codeBlockTokens`，用行范围找到 token。
4. `token.fenced === true` 才加 `aof-fenced-block`；`code_block`（缩进代码）不加。
5. 延迟 120ms/900ms 重扫 + 每个 `.markdown-preview-view` 一个 MutationObserver，处理 Obsidian/Prism 异步替换或重置类。
6. 重扫幂等；卸载时删除类、断开 observer、清空计时器和缓存。

**踩坑记录：** 只依赖 `code.textContent` 会在首次进入阅读时因 Prism 尚未完成而漏掉 10/12 个代码块；只添加一次类也会被宿主重渲染冲掉。行号映射 + 延迟重扫修复了该问题。

### 4.5 设置预览

- 背景开：标签 `浅色模式 · 主题背景 #RRGGBB`，pre 显示该背景；
- 背景关：标签 `Obsidian 原生背景`，pre 不设背景；
- 主题缺背景：标签提示回退；
- 预览 padding/圆角仅 `.aof-settings .aof-preview-code--themed`，不影响笔记。

### 4.6 生命周期

- `onunload` 清理：编辑/阅读高亮、背景类、行号节点与 CSS 变量、行号 style、CSS.highlights、观察器、计时器、缓存、style、engine。
- 禁用后真实测试：背景/高亮/行号 style 0、类 0、`aof-ln` 节点 0、highlight keys 0、原生背景恢复。
- 重启用/重启后：设置、背景、行号恢复。

### 4.7 行号（0.4.0 新增）

数据流：`settings.lineNumbers` → 编辑模式 `buildFenceDecorations` 同时产出背景行类和行号 widget；阅读模式 `markReadingFences` → `applyReadingLineNumbers`。纯计算在 `line-numbers.cjs`，CSS 在 `line-number-style.cjs`（关闭时返回空串，不创建 style 内容）。

编辑器：

- 用 `Decoration.widget`，插在 `line.from + row.column`，零长度、不进文档文本；`side: -1` 放在行首。
- widget 是 `<span class="aof-ln aof-ln-wN" aria-hidden="true">N</span>`，`ignoreEvent()` 返回 true，不拦截点击/选择；`eq()` 比较编号与宽度类，减少重复 DOM。
- 用 widget 而不是 `Decoration.line` 的 `::before`：后者固定在 `.cm-line` 左边缘，列表/引用里的代码块编号会落到背景外。
- 共享行盒，软换行只出现一个编号；`user-select:none` + `pointer-events:none`，复制不含编号。装饰缓存上限 4000。

阅读模式：

- 无法插 DOM 节点（会破坏 `<pre><code>` 结构），改用 `<pre>` 的 `::before` + `content: attr(data-aof-ln)`，实际编号文本写在属性里，测试可核对。
- `<code>` 改为 `display:block; white-space:pre; overflow-x:auto`，横向滚动发生在 code 内部；`<pre>` 用 `padding-left` 预留槽位，`--aof-ln-*` 变量传几何。
- 几何：`canvas.measureText('0')` 量等宽字符宽度；行高优先取 `<code>` 的 computed `line-height`，`normal` 时用 `clientHeight / 行数` 推算；`--aof-ln-top` 取 `code.offsetTop + paddingTop`（不能直接用 `<pre>`，它的 strut 会多一行）。
- `measureReadingLineNumbers` 幂等：重测前先扣掉上次写入的槽宽（inset + numw + gap），不会累积加宽；首次测量后 220ms 再补测一次，等主题内边距稳定。
- 重排触发：`css-change`、`resize`、`orientationchange`、`document.body` class 的 MutationObserver（浅深切换）。

编号规则：每个围栏块独立从 1；空行计数；围栏起止标记行不编号；无语言/未知语言照常编号；缩进代码、行内代码、正文不编号；`%%` 注释里的围栏按围栏处理（与高亮一致）；空围栏两种模式都不编号。

## 5. 历史构建与测试记录（v0.4.x）

以下命令计数与 Obsidian 阶段清单记录的是 v0.4.x 当时的状态；v0.5.2 的当前验证以本文件开头和 `V0.5.2-SUMMARY.md` 为准。

### 5.1 命令

```sh
npm ci
npm run verify        # check-themes + 69 项自动化
npm run build
npm run package
npm run verify-build
npm run test:webkit      # WKWebView 逐像素语法高亮（macOS + swift）
npm run test:webkit:ln   # WKWebView 行号取色 + 几何
npm run test:obsidian -- --phase=<阶段名>   # 需先启动隔离 Obsidian 并开 CDP 9333
AOF_EVIDENCE=evidence/v0.4.2 npm run test:obsidian  # 完整 22 阶段，结果写入指定目录（默认 evidence/v0.4.2）
```

### 5.2 自动化覆盖

- Atom One 0.1.0 基线逐字节；
- 39 主题前景色 + 39 官方背景；
- 15 系列预设、无虚构浅色、重复颜色审计；
- 源文件/许可证/归一化资产/VSIX 哈希；
- settings 默认、0.3.0 升级（无 `lineNumbers` 键 → 关闭）、背景布尔、浅深 CSS 隔离、缺失回退；
- 全部围栏（含未知/无语言）与缩进代码区分；
- 静态 CSS 边界；
- **行号 31 项**：宽度分级 w1–w6、每块从 1、围栏标记不计数、空行计数、缺闭合围栏、连续块、无/未知语言、缩进代码排除、`%%` 注释与行内代码排除、列表/引用列偏移、长单行、CRLF、frontmatter、畸形输入、宽度一致、阅读编号、空围栏一致、CSS 关闭时为空串、作用域与变量消费；0.4.2 新增：**编辑器行号必须 `position: absolute` 且行必须带 `calc(... Nch)` 内边距（1..6 档）**、**`lineNumberColor` 与主题前景不同且对比度 ≥2.9、且不高于代码对比度**、**无背景/非法色时返回 `null` 并回落 `--text-faint`**；
- **高亮 7 项**：选择器必须成对（宿主 + 后代）、作用域、只允许 `color`、空调色板、兼容 CSS 边界、不越界到行内代码与正文；
- **构建产物（v0.4.x 历史状态）**：当时为 `isDesktopOnly: false`；v0.5.2 已改为 `true`。Vault adapter 的 `readBinary` 仍用于读取插件 WASM 资源。

### 5.3 真实 Obsidian

环境：macOS / Obsidian 1.14.5 / Minimal 9.1.4 / Electron 43.7.7。测试库 `/tmp/aof-v040-test`，profile `/tmp/aof-v040-profile`，CDP 端口 9333，**不触碰用户库**。

22 阶段：prepare、installUpgrade、accuracy、syntaxPixels、highlightFallback、lifecycle、scopeIntegrity、editing、settingsUI、commandModal、visualEvidence、performance、fallback、persistence（以上 14 个为 v0.3.0 回归 + 0.4.1 的高亮两阶段）+ lineNumbersReading、lineNumbersEditor、lineNumbersEditing、lineNumbersSettings、mobileProxy、lineNumbersPerformance、cleanup、lineNumbersPersistence（8 个为行号阶段）。

回归部分沿用 v0.3.0 断言：39/39 主题前景与背景、三模式跨系列浅深组合、编辑 `42→41→42` 与 8 次背景开关循环、首次进入阅读 12/12 围栏、空行/长块/未知/无语言/列表/引用、行内代码与缩进代码不受影响、关闭/切换/禁用/重启、CSSOM 只有 `background-color`。

新增部分：

- **lineNumbersReading**：先显式切浅色、再切深色；断言 `appearance` 与代码块实际背景分别等于所选浅/深主题背景，且两次截图哈希不同。逐行比对各逻辑行编号文本 1..N、空行计数、宽度类、垂直中心偏差（阈值 1.5px）、与文字水平间距、`<pre>` 左侧槽位、文本内容未被修改、空围栏无编号、长行软换行仍是单个编号。
- **lineNumbersEditor**：实时预览与源码中每个围栏块的首个 `aof-ln` widget 文本为 1、块内递增、无跨块连续、widget 不落在围栏标记行、与首个可见字符不重叠（同一视觉行过滤）。0.4.2 追加：**隐藏 `.aof-ln` 后代码文本左边界位移必须 ≤0.5px**（捕获「行号参与文本排版」这类回归）、**引用块/列表内的行号必须是 `position: static`**（不得被改成 gutter 压住 `>` / `-` 标记）。
- **lineNumbersEditing**：真实键入增删行后编号重排（`42→41→42` 同类手法）、撤销重做后一致、选区/光标不被 widget 吞掉、Cmd+C 后系统剪贴板内容与选区完全一致且不含编号。
- **lineNumbersSettings**：设置页开关默认状态、切换后 `data.json` 落盘、状态行文案、命令弹窗同步、关闭后 DOM 与 CSS 无残留、重开笔记恢复。
- **mobileProxy**：折叠双侧栏 + `Emulation.setDeviceMetricsOverride`（390×844、DPR 3），检查编辑器与阅读行号、设置页不横向溢出、开关点击目标尺寸、窄屏下编号不遮挡代码；浅深 4 轮扫描断言行号色 **≠ 代码色**、也不是 `--text-faint`、且浅深两档不同。**只是窄屏模拟，不等于真机。**
- **lineNumbersPerformance**：9 个块（含 100 行块）采样 6 轮；开关平均 54.3/46.9 ms（阈值 900），阅读几何测量首次 8.6 ms、其后 0.1–0.2 ms（阈值 120）。
- **cleanup**：禁用插件后 `<pre>` 与行号节点、style 标签、CSS 变量、类名全部清除；重新启用后恢复；过程中记录 `viewRebuilt` 以免把宿主重建误判为失败。
- **lineNumbersPersistence**：重启 Obsidian 后开关仍为开、编号仍在、`data.json` 未被改写。

证据：`evidence/v0.4.2/real-obsidian-results.json` 与 `real-obsidian-run.log`（最新一次 22 阶段全绿）、`evidence/v0.4.2/README.md`（行号修复读数）、`evidence/v0.4.1/`（高亮修复）、`evidence/v0.4.0/`（基线：`real-obsidian-results.json`、`automated-tests.txt`、`theme-accuracy.md`、`regression.md` 与截图）。证据分级见 `TECH-REQUIREMENTS-HANDOFF-v0.4.0.md` 第 6 节与各证据目录的 `README.md`。

## 6. 用户数据边界

开发与测试不得访问或修改用户的实际 Vault、笔记、插件目录或设置。本项目真实 Obsidian 测试必须使用 `/tmp` 下独立 Vault 和 profile。手动升级时，用户应先备份目标插件目录与 `data.json`，并确认同 ID 插件目录只有一个正在使用的版本；插件本身不自动删除、重命名或覆盖用户安装目录。

## 7. 其余限制与风险

- Windows/Linux 是支持目标；未实机测试的平台必须在 `V0.5.2-SUMMARY.md` 明确列为未验证。iOS/iPadOS/Android 不支持。
- `onig.wasm` 通过 `vault.adapter.readBinary()` 读取，以避免平台特定绝对路径；该 Vault API 是当前桌面实现的一部分。
- 无 `Highlight`/`StaticRange`/`CSS.highlights` 的宿主会安全降级：不加高亮、不报错、不写 DOM；背景与行号仍可用。
- 无 `Highlight`/`StaticRange`/`CSS.highlights` 的宿主会安全降级：不加高亮、不报错、不写 DOM；背景与行号仍可用。
- 空围栏（```` ```js ```` 后直接闭合、无内容行）两种模式都不编号；这是 0.4.0 的既定行为，不是漏测。
- pop-out 窗口仍未适配。
- 宿主内部 API：`editorInfoField`、`tokenClassNodeProp`、`previewMode.rerender`、`app.setting.open`、`ctx.getSectionInfo` 行范围、body 主题类，未来可能变化。
- 大文档保护：单块 200k、文档 2M、单行 500ms；超过 2M 时背景与行号都不处理。
- 章节注册表缓存 1 个/侧，切换未缓存主题会有首次构建成本。
- 阅读模式行号依赖几何测量（`canvas.measureText` + computed line-height），极端的自定义主题字体/行高组合可能仍需 220ms 二次测量才对齐；测量是幂等的，不会累积加宽。
- Material 34.5.0 的 Apache 许可、上游仓库后来被重写的说明见 provenance。
- 插件不会操作用户安装目录，见第 6 节。

## 8. 接手最短可靠流程

1. 阅读本文开头、`V0.5.2-SUMMARY.md`、`V0.5.1-SUMMARY.md`，再看 `TECH-REQUIREMENTS-HANDOFF-v0.4.0.md` 了解历史。
2. 读 `main.cjs` 的背景/阅读/行号方法（`buildFenceDecorations`、`markReadingFences`、`measureReadingLineNumbers`、`scheduleReadingLineNumberGeometry`、`loadWasmBytes`）、`fences.cjs`、`line-numbers.cjs`、`line-number-style.cjs`、`background-style.cjs`、`settings.cjs`。
3. `npm run verify` 运行当前主题资产检查与 Node 测试。
4. 修改后用 `npm run build && npm run package && npm run verify-build`，确认生成 manifest 的 `isDesktopOnly` 为 `true`。
5. 涉及高亮/背景/行号/生命周期/横滚，重跑 `/tmp` 隔离 Obsidian 的完整套件，并核对代码块横向滚动隔离与编辑交互。
6. 检查真实 DOM：行号文本与位置、`data-aof-ln` 计数、背景色、CSSOM 属性、禁用后残留、笔记原文不变，而不是只看 CSS 文本/设置页。
7. 不覆盖用户实际库，不对外发布。
8. 结论必须按 macOS、Windows、Linux 分别报告实际测试状态；窄视口模拟只能说明该桌面窗口尺寸下的行为。

## 9. 可复制给下一位 AI 的开场指令

> 请先阅读 AI-HANDOFF.md、V0.5.2-SUMMARY.md、V0.5.1-SUMMARY.md、manifest.json、plugin-src/main.cjs、engine.cjs、editor-scroll.cjs、line-numbers.cjs 和 settings.cjs。当前正式身份是 Syntax Palette（ID `syntax-palette`），0.5.2 桌面专用版：支持目标 macOS、Windows、Linux；iOS/iPadOS/Android 不支持。保留 15 个系列、39 个变体、浅深独立选择、主题预设、语法高亮、彩色括号、背景/行号/自动换行开关、编辑/实时预览/阅读模式和围栏独立横向滚动。检查构建生成的 `manifest.json` 含 `isDesktopOnly: true`。Vault adapter `readBinary()`、通用缺失高亮 API 降级、渲染缓存和滚动性能优化仍是共享实现，不要误删。不得移动整篇编辑器或让不同代码块共用横滚状态。不要修改用户 Vault、笔记或插件设置，不对外发布。运行 `npm run verify`、`npm run build`、`npm run package`、`npm run verify-build` 和完整 `/tmp` 隔离 Obsidian 回归；按 macOS/Windows/Linux 分别标明已测与未测。
