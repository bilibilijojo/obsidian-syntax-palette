# v0.3.0 技术与需求说明书 / AI 接手手册

- 版本：`0.3.0`
- 整理日期：2026-10-19
- 目标环境：macOS / Obsidian 1.14.4 / Minimal 9.1.4
- 插件 ID：`atom-one-fenced-syntax`
- 显示名称：`Atom One Fenced Syntax`
- 构建产物：`plugin/atom-one-fenced-syntax/`
- 手动安装包：`atom-one-fenced-syntax-0.3.0.zip`（477 KiB；SHA-256 `f8749cb584ff794d0c8366a841e70f25198ffd8c8d2c119824fd2a0e4dddd899`）
- 主题目录：15 个系列、39 个变体（浅色 12、深色 27）
- 自动化测试：31/31 通过
- 隔离 Obsidian 实机套件：12 个阶段全部通过

本文面向接手开发的其他 AI / 工程师，覆盖 v0.3.0 的产品需求、技术方案、主题来源、背景实现、构建、测试证据和禁止事项。

---

## 0. 一分钟结论

- v0.3.0 在 v0.2.0 的 6 个系列、17 个变体基础上，新增 9 个系列：Tokyo Night、One Dark Pro、Night Owl、Nord、Solarized、Kanagawa、Material Theme、Monokai、Min Theme。
- 新增默认关闭的“使用所选主题的代码块背景”开关。关闭时完全保留 Obsidian 原生背景；开启时只给围栏代码块增加 `background-color`。
- 背景严格跟随 Obsidian `.theme-light` / `.theme-dark`；浅色只使用所选浅色主题的官方背景，深色只使用所选深色主题的官方背景。用户通过 Obsidian 设置、系统外观联动或命令切换外观时，无需重新打开设置页或重载插件。
- 实时预览、源码、阅读三种模式均完成真实 Obsidian 验证，包括空行、连续块、未知/无语言围栏、列表/引用、长块滚动、行内代码和缩进代码边界。
- 既有 17 个变体、浅深独立选择、系列预设、彩色括号、设置页、命令面板、持久化、回退、禁用恢复均保留。Atom One 0.1.0 输出基线逐字节未变。
- Material Theme 固定使用官方 34.5.0（Apache-2.0）；后续 34.7.x 限制性许可版本未使用。Solarized 与 Kanagawa 明确标注为 MIT 许可的第三方 VS Code 移植版。
- 用户实际安装目录仍存在 `atom-one-fenced-syntax` 与 `atom-one-fenced-syntax 2` 重复目录风险。开发和测试未修改用户目录；升级前必须由用户备份并整理。

---

## 1. 交付物与权威文件

| 文件/目录 | 说明 |
| --- | --- |
| `plugin-src/main.cjs` | Obsidian 生命周期、编辑/阅读集成、背景行装饰、阅读背景重扫、设置页、命令弹窗、刷新和清理 |
| `plugin-src/engine.cjs` | TextMate 引擎、双主题 Registry、括号、回退、缓存 |
| `plugin-src/themes.cjs` | 主题目录、系列、预设、安全选择 |
| `plugin-src/settings.cjs` | 配置规范化、默认值、补丁、预设、选项 |
| `plugin-src/highlight-style.cjs` | 只输出 `color` 的语法高亮 CSS |
| `plugin-src/background-style.cjs` | 只输出 `background-color` 的背景 CSS，含浅深隔离与主题校验 |
| `plugin-src/fences.cjs` | 围栏解析、全部围栏、阅读代码块 token、坐标映射 |
| `plugin-src/assets/themes.json` | 生成的 39 变体资产，含前景色与官方背景色 |
| `plugin-src/styles.css` | 只服务设置页/弹窗的 `.aof-*` 样式 |
| `plugin-src/tests/` | 31 个 Node 自动化测试 |
| `plugin-src/tests/fixtures/theme-expectations.json` | 39 个变体的真实 DOM 前景色/背景期望值 |
| `sources/themes/sources.json` | 人工维护的精确主题来源、版本、URL、许可证、VSIX 哈希 |
| `sources/theme-provenance.json` | 生成的全部源文件/许可证/归一化资产哈希和背景提取结果 |
| `sources/licenses/` | 17 份主题/上游许可证文本 |
| `tools/prepare-theme-assets.cjs` | 解析 JSONC 官方快照、提取前景/背景、生成资产与 provenance |
| `tools/build-plugin.cjs` | esbuild、manifest、完整许可证、README、来源和 SHA256SUMS |
| `tools/package-plugin.cjs` | 生成 ZIP 和 ZIP SHA-256 |
| `tools/verify-build.cjs` | 校验 39 主题、许可证、哈希、路径泄漏、静态 CSS 和 ZIP |
| `tools/obsidian-v0.3.0-test.cjs` | 隔离 Obsidian 真实验收套件（CDP，12 阶段） |
| `evidence/v0.3.0/` | 自动化/实机/构建证据、截图和测试样本 |
| `THEME-PROVENANCE.md` | 用户可读主题来源和许可证表 |
| `PLUGIN-README.md` | 用户安装/使用/限制说明 |
| `V0.3.0-SUMMARY.md` | 开发总结、测试结果、限制 |
| `AI-HANDOFF.md` | 面向下一位 AI 的总交接文档 |

历史文件：`TECH-REQUIREMENTS-HANDOFF-v0.2.0.md`、`V0.2.0-SUMMARY.md`、`evidence/v0.2.0/`。它们保留 0.2.0 与 0.1.0 的详细历史，不再描述当前主题数量和背景功能。

优先阅读顺序：

1. 本文。
2. `AI-HANDOFF.md`。
3. `V0.3.0-SUMMARY.md`。
4. `plugin-src/main.cjs`、`background-style.cjs`、`fences.cjs`、`settings.cjs`、`engine.cjs`。
5. `evidence/v0.3.0/real-obsidian-results.json`。
6. `THEME-PROVENANCE.md` 与 `sources/themes/sources.json`。

---

## 2. 需求与实现状态

### 2.1 主题扩展

| 需求 | 实现 |
| --- | --- |
| 保留原 6 系列、17 变体 | 全部保留；39 变体资产中逐项包含，真实 DOM 颜色验证通过 |
| 新增 9 系列 | Tokyo Night、One Dark Pro、Night Owl、Nord、Solarized、Kanagawa、Material Theme、Monokai、Min Theme |
| 目标变体 | Tokyo Night 3、One Dark Pro 3、Night Owl 2、Nord 1、Solarized 2、Kanagawa 3、Material 5、Monokai 1、Min 2 |
| 官方来源 | 官方 Marketplace VSIX、VS Code 内置主题、有明确 MIT 来源的移植版 |
| 来源/版本/许可/哈希 | `sources/themes/sources.json`、`sources/theme-provenance.json`、`THEME-PROVENANCE.md` |
| 同名/衍生/移植区分 | Solarized、Kanagawa 明确标为第三方 VS Code 移植；Material 冻结官方 Apache-2.0 版本 |
| 浅深分类 | 浅色 12、深色 27；未给 Dracula/One Dark Pro/Nord/Monokai 编造浅色 |
| 离线使用 | 主题 JSON 打进 `main.js`，WASM 随包；运行时不联网 |
| 排除 Gruvbox / Rosé Pine / Everforest | 未进入资产、下拉、构建产物或测试 |
| 不重复凑数 | 所有新增变体均有官方来源；One Dark Pro Flat 与 Pro 的插件可见颜色相同，已在文档公开说明，仅因需求点名保留 |

### 2.2 背景覆盖

| 需求 | 实现 |
| --- | --- |
| 默认关闭 | `codeBlockBackground: false`；0.2.0 的 `data.json` 无该键时也规范化为 false |
| 关闭时保留原生背景 | 不生成任何背景规则；不添加背景行类；真实 DOM 与原生值一致 |
| 开启时使用主题原生背景 | 从同一个官方主题实例的 `colors.editor.background` 提取 |
| 浅深严格匹配 | CSS 只生成 `.theme-light` 与 `.theme-dark` 两套规则；真实测试检查不串色 |
| 三种显示模式 | 实时预览/源码使用 `ViewPlugin` 行类；阅读使用原生 section 行范围映射后的 `<pre>` 类 |
| 不修改其他属性 | 背景 CSS 只有 `background-color`；真实测试比较字体、行高、边框、圆角、内外边距、几何、文本 |
| 空行/连续块/长块 | 行装饰覆盖围栏起止和内容行；阅读 pre 绘制整块；空行与长块滚动实测 |
| 未知/无语言围栏 | 都属于围栏代码，可获得背景；文本仍不做 Token 配色 |
| 缩进/行内代码 | 明确排除，背景与样式保持原生 |
| 主题缺少背景 | 该侧不生成规则，安全回退到 Obsidian 原生背景 |
| 设置持久化 | `saveData` / `loadData`；重启实测保留 |
| 设置页预览 | 浅/深双预览显示主题背景 hex、色块或“Obsidian 原生背景”标签 |
| 快速预设/独立选择/括号/命令 | 全部保留；39 项下拉用 `系列 · 变体` 标签改善查找 |

### 2.3 视觉边界

允许修改：

- 围栏代码内部语法 Token 的 `color`；
- 围栏代码块正常文字的 `color`（仍由 Token 前景色实现）；
- 背景开关开启时，围栏代码块的 `background-color`。

禁止修改：

- Markdown 正文、标题、引用、链接、行内代码；
- 缩进代码块；
- 字体、字号、字重、斜体、行高、字距；
- 边框、圆角、阴影、内外边距、布局、尺寸；
- 围栏起止标记的文字样式；
- 编辑器/全局 Obsidian 背景；
- 其他插件和用户配置。

当前满足方式：

- `highlight-style.cjs` 只生成 `color`，且选择器只针对 `::highlight()`。
- `background-style.cjs` 只生成 `background-color`，选择器只针对 `.aof-fenced-block` / `.aof-fenced-line`。
- 阅读类只加在已验证的围栏 `<pre>`；缩进 `<pre>` 不加。
- 编辑行类只加在 `allFencedBlocks()` 确认的围栏行；不是所有 `HyperMD-codeblock`。
- 设置页/弹窗样式全部在 `.aof-*` 作用域。
- 不包装文字、不插入 span、不替换原生 DOM。

---

## 3. 主题数据流

```text
sources/themes/*.json (官方快照，允许 JSONC)
  + sources/themes/sources.json (版本/URL/许可/VSIX 哈希)
        │
        ▼
tools/prepare-theme-assets.cjs
  - 解析 JSONC / include 链
  - 提取 editor.foreground (或官方默认 token 前景)
  - 提取 editor.background
  - 提取 tokenColors[].settings.foreground
        │
        ├──► plugin-src/assets/themes.json
        └──► sources/theme-provenance.json
                    │
                    ▼
             themes.cjs / settings.cjs
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
     engine.cjs          background-style.cjs
  TextMate 前景色        主题背景 CSS
          │                    │
          ▼                    ▼
 ::highlight() CSS      aof-fenced 行/块背景
```

### 3.1 JSONC

官方 Tokyo Night、Night Owl、Solarized、Nord 等快照带有注释或尾逗号。`prepare-theme-assets.cjs` 使用自写的字符串感知 JSONC 解析器：保留原始文件字节和 SHA-256，不为了解析而改写上游文件。

### 3.2 前景色规则

- 优先 `colors.editor.foreground`。
- 缺失时使用官方 `tokenColors` 首个无 scope 默认前景。
- 再缺失时使用 `colors.foreground`。
- 记录 `foregroundSource`。
- Min Dark 使用 `tokenColors.default`，值为 `#B392F0`。

### 3.3 背景色规则

- 只采用 `colors.editor.background`。
- 规范化大小写和 3/4/6/8 位十六进制。
- 无效/缺失记录 `backgroundSource: "invalid" / "missing"`，资产中 `background: null`。
- 不从其他变体借用，不做亮度调整，不选择“更好看”的颜色。
- 当前 39 个变体均有有效背景。

### 3.4 分类异常

两个官方源文件的 JSON `type` 字段与实际光暗相反：

- Tokyo Night Light：官方扩展注册为 `uiTheme: "vs"`，背景 `#E6E7ED`，JSON `type` 却写 `dark`。
- Solarized Light：官方扩展注册为 `uiTheme: "vs"`，背景 `#FDF6E3`，JSON `type` 却写 `dark`。

因此分类依据是官方扩展注册的变体和实际 `editor.background`，并在 provenance 中记录 `appearanceNote`。不要仅依赖源文件的 `type` 字段。

---

## 4. 运行时架构

### 4.1 设置与更新

`settings.cjs` 默认值：

```js
{
  light: 'atom-one-light',
  dark: 'atom-one-dark',
  coloredBrackets: true,
  codeBlockBackground: false,
}
```

- `normalizeSettings` 保留 0.2.0 的 `light`/`dark`/`coloredBrackets`，并仅在 `codeBlockBackground === true` 时开启背景。
- 非法/未知主题 ID、错误外观、旧字段 `lightTheme` / `darkTheme` 自动规范化。
- `updateSettings` 串行队列：先应用引擎主题，再保存 data.json，最后刷新装饰、背景 CSS 和设置页。
- 仅切换背景时也会保存并刷新 CSS；不会重建 TextMate Registry。
- 关闭背景后动态背景 CSS 置空，`refreshDecorations` 向所有编辑视图 dispatch `refreshEffect`，行装饰被移除。

### 4.2 编辑模式（实时预览 / 源码）

`ViewPlugin`：

- 文档变化时只解析一次围栏，结果为 `allBlocks`（全部围栏）和 `blocks`（可高亮语言）。
- 语法高亮继续使用可见区和 `::highlight()`。
- 背景开关开启时，为每个围栏的所有源码行添加 `Decoration.line({ class: 'aof-fenced-line' })`。
- 文档超过 2,000,000 code units 时不解析/不加背景。
- `refreshEffect` 触发时重新生成行装饰，不重复解析文档。
- 关闭背景时返回 `Decoration.none`，行类从 DOM 移除。
- 不添加 span、不替换 CodeMirror DOM。

### 4.3 阅读模式

阅读背景不依赖 Prism 是否已完成。关键流程：

1. 背景后处理器在 `<pre>` 上运行，读取 `ctx.getSectionInfo(pre)`。
2. `section.text` 是完整 Markdown 文本，`lineStart`/`lineEnd` 是该代码块的原生源码行范围。
3. `readingTokensFor(section.text)` 用单条目缓存解析 `codeBlockTokens()`。
4. 找到 `start` 落在 `[lineStart, lineEnd]` 内的 token；若其 `fenced: true`，给 `<pre>` 加 `aof-fenced-block`，若为 `code_block`（缩进）则不加。
5. 因为分类基于源码行号，不依赖 `code.textContent`，Prism 尚未填充文本时也能先加对类。
6. Obsidian/Prism 可能在后续替换/重设代码 DOM：插件对阅读容器安装 `MutationObserver`，并在 120ms/900ms 后延迟重扫；重新加类是幂等的。
7. 重扫只遍历当前 `.markdown-preview-view` 中已渲染的 `<pre>`；虚拟滚动新出现的块会由 postprocessor 或观察器触发。
8. `readingContainerObservers` 每个 `.markdown-preview-view` 一个；失联的根会断开清理。
9. 卸载插件时移除所有阅读类、断开 observer、清空计时器和缓存。

> 这是 v0.3.0 最容易出错的地方。只按 `code.textContent` 做映射会因 Prism 异步替换文本而漏掉背景；只依赖初次 postprocessor 也会因宿主重渲染丢失类。修改此逻辑后必须重跑真实 Obsidian 的首次进入阅读模式和滚动测试。

### 4.4 动态样式

前景色：

- style id：`atom-one-fenced-syntax-highlight`。
- `highlight-style.cjs` 生成，只含 `color`。
- 选择器限制在 `.theme-light/.theme-dark .markdown-rendered pre > code::highlight(...)` 和 `.cm-line.HyperMD-codeblock` 内容行。

背景色：

- style id：`atom-one-fenced-syntax-background`。
- `background-style.cjs` 生成，只含 `background-color`。
- 规则示例：

```css
.theme-light .markdown-rendered pre.aof-fenced-block,
.theme-light .markdown-rendered pre.aof-fenced-block > code,
.theme-light .markdown-source-view.mod-cm6 .cm-line.aof-fenced-line { background-color: #FFFFFF; }

.theme-dark .markdown-rendered pre.aof-fenced-block,
.theme-dark .markdown-rendered pre.aof-fenced-block > code,
.theme-dark .markdown-source-view.mod-cm6 .cm-line.aof-fenced-line { background-color: #24283B; }
```

- style 始终存在但关闭时为空；便于测试和快速切换。
- 只在启用时使用所选主题的背景；没有背景的侧不生成规则。
- 不使用 `!important`，依赖足够的选择器特异性；Minimal 9.1.4 实测可覆盖。

### 4.5 设置页与预览

- 新增“使用所选主题的代码块背景”Toggle，创建时读取持久化值。
- 状态区增加背景模式，并在主题缺背景时显示回退警告。
- 预览按浅/深两栏：
  - 关闭：标签 `Obsidian 原生背景`，pre 不设背景；
  - 开启：标签 `主题背景 #RRGGBB`，pre 设置该主题背景并增加 settings-only padding/圆角，使背景可见；
  - 主题缺背景：标签提示回退，不覆盖。
- 预览样式仍在 `.aof-*` 作用域，不命中笔记。
- 主题下拉标签使用 `系列 · 变体`，并保持原有 value 为稳定主题 ID。
- 命令弹窗也增加同一背景开关和状态行；不增加复杂主题商店。

### 4.6 生命周期与恢复

- `onunload`：移除编辑范围、阅读高亮、背景类、observer、计时器、样式元素、缓存，dispose engine。
- 阅读类即使背景开关关闭也存在（视觉上无影响），以便用户即时开启；禁用插件时全部移除。
- 编辑行类只在背景开关开启时添加；关闭时立即移除。
- 重新启用后，设置从 data.json 恢复；阅读 postprocessor 重跑并重新加类。

---

## 5. 主题清单与来源

### 5.1 变体数量

| 系列 | 浅色 | 深色 |
| --- | --- | --- |
| Atom One | 1 | 1 |
| GitHub | 1 | 2 |
| Ayu | 1 | 2 |
| VS Code Official | 2 | 2 |
| Catppuccin | 1 | 3 |
| Dracula | 0 | 1 |
| Tokyo Night | 1 | 2 |
| One Dark Pro | 0 | 3 |
| Night Owl | 1 | 1 |
| Nord | 0 | 1 |
| Solarized | 1 | 1 |
| Kanagawa | 1 | 2 |
| Material Theme | 1 | 4 |
| Monokai | 0 | 1 |
| Min Theme | 1 | 1 |
| **总计** | **12** | **27** |

### 5.2 来源分类

- 官方 VSIX：GitHub、Ayu、Catppuccin、Dracula、Tokyo Night、One Dark Pro、Night Owl、Nord、Solarized、Kanagawa Flavors、Material Theme 34.5.0、Min Theme。
- Microsoft VS Code 内置：VS Code Light+/Dark+/Light Modern/Dark Modern、Monokai。
- GitHub blob：Atom One Light/Dark。
- 明确移植：Solarized（Ryan Olson）、Kanagawa（paccodes / metaphore），均 MIT，并在文档与显示名中区分。
- Material Theme：官方 34.5.0 Apache-2.0；后续 34.7.x 条款限制，未用。
- One Dark Pro Flat：与 Pro 在插件可见前景/背景上相同；仅因需求点名保留，公开说明。
- 未收录：Gruvbox、Rosé Pine、Everforest。

精确版本、URL、源文件哈希、许可证和 VSIX 哈希见 `THEME-PROVENANCE.md` 与 `sources/theme-provenance.json`。

---

## 6. 构建、打包、安装

### 6.1 命令

```sh
npm ci
npm run verify        # check-themes + 31 项自动化测试
npm run build         # plugin/atom-one-fenced-syntax/
npm run package       # ZIP + ZIP SHA-256
npm run verify-build  # 产物、许可证、哈希、路径、静态 CSS、ZIP
```

`npm run prepare-themes`：更新主题资产和 provenance。
`npm run test:obsidian`：隔离 Obsidian CDP 套件（需先按 evidence README 准备环境）。

### 6.2 产物

```text
plugin/atom-one-fenced-syntax/
  main.js
  manifest.json
  styles.css
  onig.wasm
  theme-provenance.json
  grammar-provenance.json
  THIRD-PARTY-NOTICES.txt
  README.md
  THEME-PROVENANCE.md
  SHA256SUMS.txt
```

`manifest.json` 关键字段：

```json
{
  "id": "atom-one-fenced-syntax",
  "name": "Atom One Fenced Syntax",
  "version": "0.3.0",
  "minAppVersion": "1.14.0",
  "isDesktopOnly": true
}
```

### 6.3 安装路径与安全

用户实际库使用 `.obsidian-mac`：

```text
.obsidian-mac/plugins/atom-one-fenced-syntax/
```

ZIP 顶层是单个 `atom-one-fenced-syntax/` 文件夹。当前 ZIP SHA-256：`f8749cb584ff794d0c8366a841e70f25198ffd8c8d2c119824fd2a0e4dddd899`。

已知风险：用户库同时存在：

```text
.obsidian-mac/plugins/atom-one-fenced-syntax/       # v0.1.0
.obsidian-mac/plugins/atom-one-fenced-syntax 2/    # v0.2.0，曾实际启用
```

两者 manifest ID 相同，属于重复安装。**不要自动删除、重命名或覆盖任一目录。** 升级前需要用户：

1. 完全退出 Obsidian。
2. 备份两个目录和 `data.json`。
3. 确认哪个目录是当前启用版本。
4. 将旧版改为备份名，把当前目录改为规范名，或把 0.3.0 安装到确认后的目录。
5. 重新启用插件，确认数据保留。

开发/测试未触碰用户 `.obsidian-mac`。实机测试使用 `/tmp` 独立库/profile。

---

## 7. 测试与证据

### 7.1 自动化

`npm run verify`：**31/31 通过**。

覆盖：

- Atom One 0.1.0 九语言输出逐字节基线；
- 39 个主题前景色；
- 39 个官方背景值；
- 15 个系列预设合法性、浅深分类、无虚构浅色；
- 仅 One Dark Pro Pro/Flat 插件可见颜色相同；
- 主题源文件、许可证、归一化资产、VSIX 哈希；
- 设置规范化、0.2.0 升级默认关闭、背景布尔严格性；
- 背景 CSS 只含 `background-color`、浅深隔离、缺失/无效回退；
- 全部围栏（含未知/无语言）与 `code_block` 区分；
- 静态 CSS 只作用于 `.aof-*`；
- 生成资产 `--check` 无漂移。

证据：`evidence/v0.3.0/automated-tests.txt`。

### 7.2 隔离真实 Obsidian

环境：macOS、Obsidian 1.14.4、Minimal 9.1.4、Electron 43 / Chrome 150。测试库 `/tmp/aof-v030-test`，独立 profile `/tmp/aof-v030-profile`，通过 CDP 执行真实 DOM/CSSOM/CodeMirror 断言。未覆盖用户实际库。

12 个阶段全部通过：

| 阶段 | 内容 |
| --- | --- |
| prepare | 0.3.0 加载、39 主题/15 系列、Minimal、测试笔记 |
| installUpgrade | 首次安装默认关闭；0.2.0 旧配置保留、背景默认关闭 |
| accuracy | 39/39 主题前景 Token + 官方背景真实 DOM 一致 |
| lifecycle | 关闭/开启、浅→深→改深→回浅→改浅→关闭、禁用/启用 × 三模式 |
| scopeIntegrity | 空行、连续块、未知/无语言、长块、列表/引用、行内/缩进/正文边界，字体/边框/圆角/间距/几何不变 |
| editing | 实时预览/源码编辑代码后背景不丢失；两种模式各 4 次背景开关循环 |
| settingsUI | 开关、双预览、12/27 选项、系列前缀、预设、括号、状态、截图 |
| commandModal | 5 个控件（3 个下拉 + 背景/括号 2 个 toggle）、状态、取消、命令数量 |
| visualEvidence | 实时预览/源码/阅读 × 浅/深截图 + 原生背景对照 |
| performance | 12 次主题切换、8 次外观切换、20 次背景切换、模式往返；无样式/高亮/调色板增长 |
| fallback | 非法主题 ID 规范化/回退，背景开启时使用 Atom One 背景，保留旧括号设置 |
| persistence | 重启后设置与背景保留；禁用恢复、重启用恢复 |

关键结果：

- accuracy 39/39；
- 生命周期三模式共 30 个背景断言（原生/浅/深/改深/回浅/改浅/关闭/禁用/重启用）；编辑模式两种视图各 2 次编辑 + 4 次开关循环通过；
- 首次进入阅读模式即 12/12 围栏有背景，无需切模式或重载；
- 阅读底部缩进代码背景保持原生、无背景类；长围栏背景正确；
- 背景关闭时三种模式原生背景恢复；
- 编辑后背景行类/计算背景保持；8 次开启/关闭循环均正确；
- 禁用后背景/高亮 style、类、CSS.highlights 全部为 0；
- 重启后 `data.json` 与 DOM 背景均恢复。

证据：

- `evidence/v0.3.0/real-obsidian-results.json`
- `evidence/v0.3.0/real-obsidian-run.log`
- `evidence/v0.3.0/*.png`
- `evidence/v0.3.0/fixtures/background-matrix.md`

### 7.3 证据级别

- **自动化**：Node + TextMate，不是 Obsidian。
- **真实 Obsidian**：隔离库/profile 的 Obsidian 1.14.4，不是用户实际库。
- **未验证**：Windows、iOS、Android、pop-out、社区商店、长期内存/CPU 压测。

不要在缺少对应实机结果时宣称这些平台通过。

---

## 8. 已知问题与限制

1. **桌面 only**：依赖 Node 文件 API 和独立 `onig.wasm`。
2. **Pop-out 未适配**：主编辑分支显式跳过非主窗口；背景 CSS 只注入主 document。
3. **宿主内部 API 风险**：`editorInfoField`、`tokenClassNodeProp`、`previewMode.rerender`、`app.setting.open`、`ctx.getSectionInfo` 的 `lineStart/lineEnd`、`.theme-light/.theme-dark` 等不是稳定公开契约。Obsidian 升级后需重跑实机。
4. **阅读异步**：依赖 postprocessor + MutationObserver + 延迟重扫；如果未来宿主彻底更换 section 信息或阅读 DOM 结构，必须重新验证。
5. **性能**：背景开启时编辑分支每文档变化解析一次全部围栏（与高亮共用），阅读分支单条缓存；大文档 >2,000,000 字符不加背景。
6. **Material Theme 许可**：只能使用已核实的 Apache-2.0 快照（34.5.0）；不要把 34.7.x 资产拼接进来。
7. **One Dark Pro Flat**：在本插件中与 Pro 的前景/背景相同，不是独立的新颜色规则。
8. **浅色背景可能不明显**：如 GitHub Light Default 背景为 `#FFFFFF`，在浅色 Obsidian 主题中与原生 `#F5F5F5` 差异较细微；这是官方背景值，不应自行调色。
9. **宿主 pin/unpin 或禁用插件时**：Obsidian 1.14.4 可能移除实时预览原生 widget（已用空 postprocessor 对照插件复现）。与本插件颜色无关；切换阅读模式或重开笔记可恢复。
10. **测试宿主瞬时卡顿**：开发中一次全量重跑的 lifecycle CDP evaluate 等待 240s 超时；单阶段和随后无代码改动的完整重跑均通过。未计为通过，未复现，详见 evidence README。
11. **用户重复安装目录**：见 6.3，未自动整理。

---

## 9. 需求追溯矩阵

| # | 需求 | 实现 | 证据 |
| --- | --- | --- | --- |
| 1 | 保留 17 变体 | 39 变体资产包含全部旧 ID | 自动化 + accuracy |
| 2 | 新增 9 系列 | 15 系列、39 变体 | catalog + accuracy |
| 3 | 真实官方来源 | sources 快照、版本、VSIX 哈希、许可证 | provenance + 哈希测试 |
| 4 | 许可合规 | 17 份主题/上游许可证文本；Material 34.5.0 | 构建 notices + verify-build |
| 5 | 浅深分类 | 12/27；两个异常源文件按官方 uiTheme 和背景分类 | 自动化 + 文档 |
| 6 | 离线 | 资产打包，无网络依赖 | 构建 + 实机 |
| 7 | 默认关闭 | settings 默认 false；升级 false | installUpgrade + 单测 |
| 8 | 关闭保原生 | CSS 空 + 行类移除 | lifecycle + scope |
| 9 | 开启主题背景 | 同变体 editor.background | accuracy 39/39 |
| 10 | 浅深严格匹配 | 只按 `.theme-light/.theme-dark` | lifecycle + scope |
| 11 | 三模式 | 编辑 ViewPlugin、阅读 pre 映射 | lifecycle + screenshots |
| 12 | 空行/连续/长块 | 行类 + pre 背景 | scope lifecycle |
| 13 | 未知/无语言围栏 | allFencedBlocks + token `fenced` | scope 12/12 |
| 14 | 缩进/行内不变 | code_block 不加类；选择器不命中 inline | scope 样式比较 |
| 15 | 仅 background-color | background-style 生成器 | 自动化 + CSSOM |
| 16 | 设置页预览 | 主题背景标签/色块 + 原生标签 | settingsUI + 截图 |
| 17 | 持久化 | saveData/loadData | persistence |
| 18 | 禁用恢复 | onunload 清理类/observer/style | lifecycle + persistence |
| 19 | 既有功能 | 预设、括号、命令、回退 | settingsUI/commandModal/fallback |
| 20 | 不写笔记 | 无 vault 写入 | noteUnchanged |
| 21 | 性能稳定 | 有界缓存、单行解析、重复切换 | performance |

---

## 10. 接手检查清单

### 第一步：确认基线

```sh
cd /path/to/obsidian-syntax-palette
npm ci
npm run verify
npm run build
npm run package
npm run verify-build
```

### 第二步：读代码

优先 `main.cjs` 的背景相关部分：

- `markReadingFences`
- `readingTokensFor`
- `observeReadingBackgroundContainers`
- `scheduleReadingBackgroundRescan`
- `rescanReadingBackgrounds`
- `buildFenceDecorations`
- `rebuildBackgroundStyle`
- `refreshDecorations`
- `onunload`

再读 `fences.cjs` 的 `allFencedBlocks` / `codeBlockTokens`、`background-style.cjs`、`settings.cjs`。

### 第三步：修改主题

1. 获取官方资产和许可证，存入 `sources/`。
2. 更新 `sources/themes/sources.json`（版本、URL、VSIX/源文件哈希、许可、port 标记）。
3. `npm run prepare-themes`。
4. 更新 `theme-expectations.json`（真实测试期望颜色/背景）。
5. 更新测试、`THEME-PROVENANCE.md`、通知文件。
6. `npm run verify && npm run build && npm run package && npm run verify-build`。
7. 在真实 Obsidian 中至少验证新主题的前景/背景和三模式。

### 第四步：修改背景/阅读生命周期

必须重跑：

- `npm run verify`
- 真实 Obsidian `installUpgrade`、`lifecycle`、`scopeIntegrity`、`persistence`
- 首次进入阅读、滚动到长块/底部、切换外观、禁用/重启用
- CSSOM 只含 `background-color`

不要只看设置页或注册数量。

### 第五步：禁止事项

- 不要修改用户实际 `.obsidian-mac`、用户笔记、Minimal 配置。
- 不要自动整理或删除重复插件目录。
- 不要凭截图/记忆重建主题颜色。
- 不要使用 Material 34.7.x 限制性许可资产。
- 不要添加非官方未授权主题冒充官方。
- 不要扩大背景到行内代码/缩进代码/正文，或修改字体/边框/圆角/间距。
- 不要通过添加 span、克隆 DOM、修改 Markdown 原文实现背景。
- 不要公开发布、推送远程或上架社区商店。
- 不要把自动化/隔离实机结果说成用户实机或 Windows/iOS 已验证。

---

## 11. 命令速查

```sh
npm run verify
npm run check-themes
npm test
npm run build
npm run package
npm run verify-build
npm run prepare-themes
npm run test:obsidian   # 需隔离测试库和 CDP 实例
```

关键路径：

```text
plugin-src/main.cjs
plugin-src/background-style.cjs
plugin-src/fences.cjs
plugin-src/settings.cjs
plugin-src/engine.cjs
plugin-src/assets/themes.json
sources/themes/sources.json
sources/theme-provenance.json
tools/prepare-theme-assets.cjs
tools/obsidian-v0.3.0-test.cjs
evidence/v0.3.0/real-obsidian-results.json
```

---

## 12. 最后提醒

- 当前 ZIP、构建产物、源码和证据需保持一致；任何修改后重新跑完整链路。
- 背景功能的成败最终以真实 DOM 的计算背景色和边界比较为准，不以设置页截图或 CSS 文本存在为准。
- 用户实际安装目录仍是独立风险；没有明确授权时不要触碰。
- 主题数量可以继续增加，但必须坚持来源、许可、哈希和真实颜色验证。
