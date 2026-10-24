# v0.4.0 技术交接（代码行号 + 移动端适配）

本文件面向后续维护者，说明 v0.4.0 相对 v0.3.0 的技术变化、实现边界、验证证据和已知风险。用户说明见 `PLUGIN-README.md`，开发总结见 `V0.4.0-SUMMARY.md`，历史交接见 `TECH-REQUIREMENTS-HANDOFF-v0.3.0.md`。

## 1. 版本与产物

| 项目 | 值 |
| --- | --- |
| 插件 ID | `atom-one-fenced-syntax`（未变） |
| 显示名称 | Atom One Fenced Syntax（未变） |
| 版本 | 0.4.0 |
| `minAppVersion` | 1.14.0（未变） |
| `isDesktopOnly` | **false**（v0.3.0 为 true） |
| `data.json` | 在 v0.3.0 基础上新增 `lineNumbers: boolean`，默认 false |
| 主题库 | 15 系列 / 39 变体，颜色、来源、版本、许可未变 |

构建产物目录 `plugin/atom-one-fenced-syntax/`，包含：

```
main.js                     esbuild 打包，2.6 MB
manifest.json               version 0.4.0, isDesktopOnly false
styles.css                  仅静态设置页样式（2.0 KB）
onig.wasm                   运行时 WASM（462 KB）
README.md                   用户说明（由 PLUGIN-README.md 复制）
THIRD-PARTY-NOTICES.txt
THEME-PROVENANCE.md
theme-provenance.json
grammar-provenance.json
SHA256SUMS.txt
```

## 2. 源码结构

```
plugin-src/
  main.cjs                  插件生命周期、设置页/命令弹窗、编辑器装饰、阅读模式、行号几何
  engine.cjs                vscode-textmate 双 Registry、主题解析、Token 缓存、括号配对
  fences.cjs                markdown-it 围栏解析（allFencedBlocks / fencedBlocks / codeBlockTokens）
  line-numbers.cjs          新增：纯函数行号规划（不加 DOM 依赖，可单测）
  line-number-style.cjs     新增：行号 CSS 生成（关闭时返回空串）
  settings.cjs              默认值、规范化、patch、预设、sameSettings
  themes.cjs / highlight-style.cjs / background-style.cjs
  assets/themes.json        39 变体
  assets/grammars/          TextMate 语法
  tests/*.test.cjs          node --test
```

## 3. 行号实现

### 3.1 数据流

```
Markdown 文本
  └─ allFencedBlocks()          只产出内容行的 {line, column}，排除围栏标记、缩进代码、%%注释%% 内的围栏
       └─ blockNumberRows()     每块独立 1..N；空内容块返回 []
            ├─ 编辑器：Decoration.widget（零长度）
            └─ 阅读模式：readingNumbering() → data-aof-ln="1\n2\n3"
```

编号规则集中在一个纯函数文件里，编辑器与阅读模式共用，因此不会出现两套编号逻辑漂移。

### 3.2 编辑器（实时预览 / 源码）

- `ViewPlugin` 在 `buildFenceDecorations()` 中同时构建背景行装饰和行号 widget。
- widget 插入位置为 `line.from + row.column`：列表/引用中的代码块，编号落在代码块背景内，而不是容器左边缘。
- `WidgetType.eq()` 比较编号与宽度类，避免每次重绘都重建 DOM；`ignoreEvent()` 返回 true，点击不触发编辑行为。
- `side: -1` 保证编号位于代码文本之前；`Decoration.widget` 是零长度，不进入文档、不进入选区、不进入撤销栈。
- 行号宽度按块内最大位数分级（`aof-ln-w1`..`w6`），右对齐，代码左边缘保持一条直线。
- 装饰缓存上限 4000 个 widget，避免超长文档无限增长。
- 开关关闭时 `buildFenceDecorations()` 在背景与行号都关闭时直接返回 `Decoration.none`，不产生任何 DOM。

### 3.3 阅读模式

阅读模式一个围栏只有一个 `<pre><code>`，没有逐行元素，因此：

- 在 `<pre>` 上加 `aof-ln-on`，用绝对定位的 `::before` 渲染整列编号（`content: attr(data-aof-ln)`，`white-space: pre` 逐行堆叠）。
- `<code>` 设为 `display:block; white-space:pre; overflow-x:auto`，让每个逻辑行占一个视觉行，长行在块内横向滚动；`<pre>` 自身不产生横向滚动。
- 运行期实测并写入 CSS 变量：`--aof-ln-inset`、`--aof-ln-numw`、`--aof-ln-top`、`--aof-ln-lh`、`--aof-ln-size`、`--aof-ln-font`、`--aof-ln-maxh`；`padding-left` 预留编号槽位。
- 行高优先取 `<code>` 的 computed `line-height`；为 `normal` 时用 `clientHeight / 行数` 推算，避免 `<pre>` strut 造成整体偏移。
- 测量采用“先批量读、再批量写”，避免每个块触发一次布局。
- `measureReadingLineNumbers()` 可重复执行：写入的 `padding-left` 会被扣除后再计算基础内边距，不会在主题切换或二次测量时越加越宽。
- `scheduleReadingLineNumberGeometry()` 在首次测量后 220ms 再补测一次，修正主题 CSS/字体晚到造成的偏移。
- 重排触发：设置变化、`css-change`、`resize`、`orientationchange`、`body` class 变化（浅深切换）、阅读区延迟重扫。
- 清理：`clearReadingLineNumbers()` 移除类、`data-aof-ln`、计数属性、基础内边距与全部 CSS 变量；`onunload` 再兜底遍历一次。

### 3.4 空围栏

内容为空的围栏在两种模式下都不编号（没有代码行可指）。编辑器 `blockNumberRows()` 对 `text === ''` 返回空数组，阅读模式 `readingNumbering('')` 返回 `count: 0`。单测与实机都覆盖此边界。

### 3.5 复制与编辑安全

- 编辑器：widget 不在文档字符串中，`Cmd/Ctrl+C` 由 CodeMirror 从文档取文本，实测剪贴板内容与选区完全一致且不含数字。
- 阅读模式：编号是 `::before` 生成内容 + `user-select: none`，不进入 DOM 文本，复制 `<pre>` 只得到原始代码。
- 行号开关只触发装饰重建，不修改文档；实测插入行、撤销、中文输入、光标位置均不受影响。

## 4. 移动端适配

### 4.1 资源加载（v0.3.0 的阻塞点）

v0.3.0 使用 `fs.readFileSync` + `adapter.getBasePath()`，两者在 iOS/Android WebView 中不存在。v0.4.0 改为：

```js
const buffer = await this.app.vault.adapter.readBinary(`${dir}/onig.wasm`);
const bytes = new Uint8Array(buffer);
```

- `dir` 优先取 `this.manifest.dir`，回退 `${configDir}/plugins/${id}`；兼容 `.obsidian`、`.obsidian-mac` 等自定义配置目录。
- 失败重试 2 次，仍失败则 `engineReady = false`，保留 Obsidian 原生高亮并提示，不崩溃。
- bundle 中已无 `require("node:fs")`、`require("node:path")`、`require("fs")`、`getBasePath`，构建校验会拦截回归。

### 4.2 能力检测

- `highlightSupported = Boolean(window.Highlight && window.StaticRange && CSS?.highlights)`。
- 不支持时不注册 `::highlight` 规则，设置页显示降级说明；背景、行号、主题选择仍可用。
- `isMobile` 只影响阅读模式编号的间距常数（gap 8/2 对 10/4），不改变结构。

### 4.3 平台差异

- 设置页全部使用 Obsidian 原生 `Setting` 组件，窄屏由宿主自行换行。
- 行号 DOM 不使用 hover、pointer 事件或桌面快捷键。
- 未使用 `process`、`Buffer`、`path`、`fs`、`electron`、`child_process`。

## 5. 兼容性与数据

- `normalizeSettings()` 对缺失 `lineNumbers` 返回 false；只有严格 `=== true` 才开启。0.3.0 的 `data.json` 原样升级，不会自动打开行号。
- `sameSettings()` 纳入 `lineNumbers`，避免保存相同值时触发无意义重建。
- 其余三个设置键名、语义、默认值不变。
- 桌面与移动共用同一 `data.json`，Obsidian Sync 不会因平台不同产生结构差异。
- 不迁移插件 ID，不改目录名，不写入笔记。

## 6. 测试体系

### 6.1 Node 自动化

```
npm test          node --test plugin-src/tests/*.test.cjs   （59 项）
npm run verify    check-themes + npm test
```

新增 `plugin-src/tests/line-numbers.test.cjs`（28 项）：编号规划、宽度分级、空行、围栏标记、连续块、无/未知语言、列表/引用列偏移、长行、CRLF、frontmatter、空围栏、阅读编号、CSS 作用域、宽度类完整性、CSS 变量消费。

### 6.2 真实 Obsidian 套件

`tools/obsidian-v0.4.0-test.cjs`（由 v0.3.0 套件扩展）：

- 保留 v0.3.0 的 12 个阶段作为回归门禁；
- 新增 8 个阶段：`lineNumbersReading`、`lineNumbersEditor`、`lineNumbersEditing`、`lineNumbersSettings`、`mobileProxy`、`lineNumbersPerformance`、`cleanup`、`lineNumbersPersistence`；
- 共 20 个阶段，逐个输出 `pass` 与明细到 `evidence/v0.4.0/real-obsidian-results.json`。
- 阅读阶段先显式切浅色，再切深色，并断言 `appearance`、代码块实际背景等于所选主题背景、两次截图哈希不同；编辑器阶段固定浅色并记录外观。
- 性能阈值：开关 <900 ms、单次阅读几何测量 <120 ms。实测开关 30.6/27.9 ms，测量首次 11.1 ms、稳定 0.3–0.5 ms。

运行前提：

```sh
# 独立测试库与 profile（不要指向用户库）
AOF_TEST_VAULT=/tmp/aof-v040-test \
AOF_OBSIDIAN_PROFILE=/tmp/aof-v040-profile \
AOF_CDP_PORT=9333 \
node tools/obsidian-v0.4.0-test.cjs
```

测试库需要两个笔记：`AOF v0.4 DOM Probe.md`（v0.3.0 回归用）与 `AOF v0.4 Line Numbers.md`（行号矩阵，源文件在 `evidence/v0.4.0/fixtures/`）。

### 6.3 证据分级

| 级别 | 含义 | 本次覆盖 |
| --- | --- | --- |
| 开发完成 | 代码与构建产物存在 | 行号、移动端资源加载、能力降级 |
| 模拟环境验证 | 真实 Obsidian + 窄屏/设备模拟 | macOS 1.14.5 + 390×844 DPR3 |
| 真实设备验证 | iOS/iPadOS/Android 真机 | **未执行** |

`mobileProxy` 阶段的结果明确标记 `evidenceLevel: "simulated-viewport"`，并记录 `platform.isMobile === false`，不得据此宣称真机通过。

版本说明：`/Applications/Obsidian.app` 的 bundle 为 1.14.4，但隔离 profile 会自动下载并加载 `obsidian-1.14.5.asar`，实际运行版本以窗口标题为准（`AOF v0.4 DOM Probe - aof-v040-test - Obsidian 1.14.5`）。测试脚本从 `document.title` 提取该版本写入结果，避免用 bundle 版本冒充实际版本。Electron 43.7.7。

## 7. 已知问题

1. 移动端未上真机。触控选择、软键盘、输入法候选栏、横竖屏切换、后台恢复仍需设备验收。
2. 阅读模式编号依赖 `::before` 与 `padding-left`。若用户主题对 `pre` 使用 `!important` 的 padding 或 `::before`，编号可能错位；插件只写入内联样式，优先级低于 `!important`。
3. 空围栏不编号（设计决定，两种模式一致）。
4. 独立弹出窗口（pop-out）未适配，与 v0.3.0 相同。
5. 超长文档保护沿用 v0.3.0：单块 >200k 字符、文档 >2M 字符时不做语法高亮；行号仍按解析出的围栏行工作，但未针对 2M 字符文档单独压测。
6. Obsidian 1.14 在禁用注册 Markdown 后处理器的插件后，宿主可能重建视图实例；测试脚本必须重新解析当前 leaf，而不是缓存旧 `view`。这属于宿主行为，插件不修改这些 DOM；重新打开笔记即可恢复。
7. 阅读模式渲染是分段的：窗口很窄时，首屏之外的 `<pre>` 可能尚未生成，行号随之延后出现；滚动后由重扫补齐。

## 8. 禁止事项（沿用 v0.3.0）

- 不使用 Material 34.7.x；固定 34.5.0（Apache-2.0）。
- 不改变 39 个主题的 ID、来源、版本、许可和颜色值。
- 不把阅读模式背景退化为 Prism 文本匹配（必须走 section 行范围）。
- 不修改用户笔记、用户实际插件目录、Obsidian 全局配置。
- 不删除或整理用户库中同 ID 的重复安装目录。
- 不联网下载主题或运行时资源。
