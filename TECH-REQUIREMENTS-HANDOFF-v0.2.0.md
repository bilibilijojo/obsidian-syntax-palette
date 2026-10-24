# v0.2.0 技术与需求说明书 / AI 接手手册

- 版本：`0.2.0`
- 整理日期：2026-10-19
- 目标环境：macOS / Obsidian 1.14.4 / Minimal 9.1.4
- 插件 ID：`atom-one-fenced-syntax`
- 显示名称：`Atom One Fenced Syntax`
- 构建产物：`plugin/atom-one-fenced-syntax/`
- 手动安装包：`atom-one-fenced-syntax-0.2.0.zip`
- ZIP SHA-256：`b9d957e47756de5b630dd586e17bfa05cc57ae003163e0aaffbff3bf2f17a6fa`

本文面向接手开发的其他 AI / 工程师。它同时覆盖产品需求、技术方案、代码入口、测试证据、当前安装状态和禁止事项。

---

## 0. 一分钟结论

- 0.2.0 已完成：6 个主题系列、17 个配色变体、浅色/深色独立选择、系列预设、设置页、命令面板入口、持久化、主题切换刷新、异常回退、彩色括号开关。
- 严格视觉边界保持不变：只改 Markdown 围栏代码内部的 Token 前景色，不改背景、字体、排版、行内代码、围栏标记、Obsidian 主题或其他插件。
- Atom One 0.1.0 的颜色输出已做逐字节回归，未退化。
- 自动化测试 26/26 通过。
- 隔离 Obsidian 1.14.4 实机套件 10 个阶段全部通过：17/17 主题颜色、108 项语言/视图/外观矩阵、边界、编辑、设置页、命令弹窗、性能、回退、重启持久化。
- 用户当前安装目录存在历史遗留的重复文件夹：旧 0.1.0 在 `atom-one-fenced-syntax`，新 0.2.0 在 `atom-one-fenced-syntax 2`，当前已启用并写入 `data.json`。建议按第 12 节安全整理；不整理也能运行，但后续升级容易再次混乱。
- 未验证 Windows、iOS、Android；仍为 desktop-only；pop-out 未适配；只做 TextMate，不做 LSP/语义 Token。

---

## 1. 交付物与权威文件

| 文件/目录 | 说明 |
| --- | --- |
| `plugin-src/` | 插件源码主入口 |
| `plugin-src/main.cjs` | Obsidian 生命周期、编辑/阅读集成、设置页、命令弹窗、刷新和清理 |
| `plugin-src/engine.cjs` | TextMate 引擎、多主题选择、浅深计算、括号、回退、缓存 |
| `plugin-src/themes.cjs` | 归一化主题目录、家族、预设、安全选择 |
| `plugin-src/assets/themes.json` | 生成的主题资产，只含前景色 |
| `plugin-src/settings.cjs` | 配置规范化、补丁、预设、选项 |
| `plugin-src/highlight-style.cjs` | 动态高亮 CSS 生成器，只输出 `color` |
| `plugin-src/fences.cjs` | Markdown 围栏提取与坐标映射 |
| `plugin-src/styles.css` | 仅设置页/弹窗 UI，作用域 `.aof-*` |
| `plugin/atom-one-fenced-syntax/` | 可安装构建产物，不要当源码入口 |
| `atom-one-fenced-syntax-0.2.0.zip` | 手动安装包 |
| `PLUGIN-README.md` | 用户安装/使用说明 |
| `THEME-PROVENANCE.md` | 用户可读主题来源和许可证表 |
| `sources/themes/sources.json` | 主题精确来源、版本、URL、许可证 |
| `sources/theme-provenance.json` | 源文件/许可证/归一化资产哈希 |
| `sources/licenses/` | 全部主题原始 MIT 许可证 |
| `V0.2.0-SUMMARY.md` | 开发总结、测试、限制 |
| `AI-HANDOFF.md` | 完整项目交接文档；第 0 节是 v0.2.0 摘要 |
| `evidence/v0.2.0/` | 自动化、实机、构建和截图证据 |
| `plugin-src/tests/fixtures/atom-one-baseline.json` | 0.1.0 全量回归基线 |

优先阅读顺序：

1. 本文。
2. `AI-HANDOFF.md` 第 0 节。
3. `V0.2.0-SUMMARY.md`。
4. `plugin-src/main.cjs`、`engine.cjs`、`themes.cjs`、`settings.cjs`、`highlight-style.cjs`。
5. `evidence/v0.2.0/real-obsidian-results.json`。

---

## 2. 需求分析

### 2.1 产品目标

把原本仅支持 Atom One Light / Dark 的插件升级为多主题语法配色插件，让用户：

- 在 Obsidian 浅色和深色外观下分别选择语法配色；
- 两个方向可来自不同主题系列；
- 通过系列预设快速设置，再独立微调；
- 设置持久化，重启后继续生效；
- 切换主题后当前打开的笔记立即正确刷新；
- 不改变 Obsidian 当前主题、代码块外观、字体和排版。

### 2.2 主题清单与实现状态

需求正文写“6 个系列、16 个变体”，但表格实际列出 17 个。**实现按表格的 17 个全部完成**：

| 系列 | 浅色 | 深色 |
| --- | --- | --- |
| Atom One | Atom One Light | Atom One Dark |
| GitHub | GitHub Light Default | GitHub Dark Default、GitHub Dark Dimmed |
| Ayu | Ayu Light | Ayu Dark、Ayu Mirage |
| VS Code Official | Light+、Light Modern | Dark+、Dark Modern |
| Catppuccin | Latte | Frappé、Macchiato、Mocha |
| Dracula | 无 | Dracula Official |

统计：浅色 6 个，深色 11 个，共 17 个；6 个系列。

### 2.3 功能需求拆解

| 需求 | 实现 |
| --- | --- |
| 内置 17 个变体 | `plugin-src/assets/themes.json`；由官方快照生成 |
| 官方真实配色 | 主题 JSON 快照 + 版本 + URL + SHA-256 + MIT 许可证 |
| 离线可用 | 构建时打包主题，运行时不联网 |
| 保留 Atom One | 使用原 akamud 快照；0.1.0 输出快照回归 |
| 浅/深独立选择 | `settings.light` / `settings.dark`；引擎两套 Registry |
| 跟随 Obsidian 外观 | 动态 CSS 用 `.theme-light` / `.theme-dark` |
| 系列快速预设 | `applyPreset()`；Dracula 只改深色 |
| 设置页 | `SyntaxThemeSettingTab`；下拉、状态、预览、括号开关 |
| 命令面板入口 | `choose-syntax-theme` 弹窗；`open-syntax-theme-settings` |
| 当前选择状态 | 设置页状态区；回退告警 |
| 彩色括号开关 | `coloredBrackets`；默认 true；静态 VS Code 括号色 |
| 修改立即应用 | `updateSettings()` 串行队列 + `refreshDecorations()` |
| 持久化 | `saveData(this.settings)`；`loadData()` 规范化 |
| 重启保留 | 实机重启测试通过 |
| 切换无残留 | 清空所有 editor/reading Range、旧 palettes、旧 CSS |
| 不改 Markdown | 不写笔记；实机 `noteUnchanged:true` |
| 加载失败回退 | 单侧回退 Atom One；状态告警 |
| 禁用恢复 | 清除 highlights；无新增 span；文字/样式/几何保持 |
| 性能稳定 | 96 条结果缓存 + 1 个/侧主题注册表缓存；12 次切换约 1.35s |

### 2.4 视觉边界（最高优先级）

允许改的只有：**围栏代码内部语法 Token 的文字前景色**。

明确禁止：

- 代码块背景、边框、圆角、阴影、内外边距；
- 字体、字号、字重、斜体、行高、字距；
- Markdown 正文、标题、引用、链接、行内代码；
- 围栏起止标记；
- Obsidian 当前主题、Minimal 文件、Minimal Theme Settings；
- 其他插件的功能、配置和 UI。

代码层面的保证：

- 动态高亮 CSS 只输出 `color`，选择器只针对 `pre > code::highlight(...)` 和 `.cm-line.HyperMD-codeblock::highlight(...)`；
- 阅读和编辑都不添加文字 span，不替换原生 DOM；
- 静态 `styles.css` 只服务设置页/弹窗，全部选择器在 `.aof-*` 下；
- 设置页预览的字体/行高只作用于 `.aof-preview-code`，不影响笔记。

### 2.5 兼容性与非目标

兼容性要求：

- 保留 0.1.0 的六种语言、别名、围栏识别、三维视图、禁用恢复；
- 插件 ID 不变，避免用户配置迁移；
- 实机验收以 macOS / Obsidian 1.14.4 为基准；
- 不覆盖用户现有 Obsidian 配置。

本次明确不做：

- 自定义主题 JSON 导入；
- 在线主题下载 / 主题市场；
- 修改代码块背景和整体外观；
- 语言服务器 / 语义 Token；
- 新编程语言；
- iOS / Android 专项适配；
- 社区商店上架；
- 插件 ID 迁移或整体品牌重命名；
- 与需求无关的大规模重构。

### 2.6 需求歧义与已做决策

| 歧义/取舍 | 决策 |
| --- | --- |
| 正文“16 个变体” vs 表格 17 个 | 按表格实现 17 个；所有文档明确写出 |
| 是否改显示名称 | 不改，仍为 `Atom One Fenced Syntax`，降低品牌/用户认知风险 |
| Dracula 预设 | 只设置深色，浅色保持用户原选择；不伪造浅色主题 |
| 彩色括号颜色 | 使用 VS Code 默认括号配对色，不按主题重新取色；可关闭 |
| 主题来源 | 优先使用官方 Marketplace VSIX 内的主题文件或 VS Code 内置主题；保留原始 JSON 和许可证 |
| 括号是否 Token 颜色 | 括号是独立插件功能；主题准确性测试在关闭括号时进行 |
| 弹窗位置 | 命令弹窗在当前活动窗口打开；设置页在 Obsidian 1.14.4 是独立 popout 窗口 |

---

## 3. 技术架构

### 3.1 总体数据流

```text
设置页/命令弹窗/data.json
        │
        ▼
settings.cjs 规范化 ──► engine.setThemes(light, dark, brackets)
        │                           │
        │                           ├─ 主题目录 themes.cjs
        │                           ├─ 官方快照 → prepare-theme-assets.cjs → themes.json
        │                           └─ TextMate Registry（light / dark 各一套）
        ▼
fencedBlocks() ──► engine.highlight(language, text)
        │                           │
        │                           ▼
        │               逐行 {from,to,light,dark}
        ▼
┌───────────────────────┬────────────────────────────┐
│ CodeMirror ViewPlugin │ MarkdownPostProcessor      │
│ DOM Range             │ StaticRange                │
└───────────┬───────────┴──────────────┬─────────────┘
            ▼                          ▼
     CSS.highlights + 动态 ::highlight 规则（只写 color）
```

### 3.2 主题资产生成

`tools/prepare-theme-assets.cjs`：

1. 读取 `sources/themes/sources.json`。
2. 递归解析官方主题的 `include` 链（VS Code 内置主题使用）。
3. 合并 `colors` 和 `tokenColors`。
4. 只保留 `colors.editor.foreground` 和 `tokenColors[].settings.foreground`。
5. 规范化颜色为大写 6/8 位十六进制；非十六进制值按 `vscode-textmate` 行为忽略。
6. 生成 `plugin-src/assets/themes.json`。
7. 生成 `sources/theme-provenance.json`，记录源文件、许可证、归一化主题的 SHA-256。
8. `--check` 模式用于验证生成资产是否与源快照一致。

关键点：

- 不导入背景、字体样式、UI 颜色、语义 Token 颜色。
- 保留官方规则顺序，TextMate 特异性仍由 `vscode-textmate` 处理。
- 每个变体有 `appearance`（light/dark）、家族、名称、`foreground`、`tokenColors`。

### 3.3 引擎

`plugin-src/engine.cjs` 接口：

```js
await engine.initialize(wasmBytes, {light, dark, coloredBrackets});
await engine.setThemes(lightId, darkId, {coloredBrackets});
const rows = engine.highlight(language, codeText);
engine.getState();
engine.dispose();
```

设计：

- `light`、`dark` 各一个 `vscode-textmate` Registry；每个 Registry 加载 9 份语法。
- `tokenizeLine2()` 生成颜色 ID，保留 `ruleStack` 处理多行上下文。
- 分别计算 light/dark 区间，再合并边界，输出每个字符区间的双主题颜色。
- 括号配对另用一次 `tokenizeLine()`；用 scope 排除 comment/string。
- `setThemes()` 只重建发生变化的一侧；未知/损坏主题回退 Atom One，返回 warnings。
- 注册表缓存：每侧保留最近 1 个主题；来回切换复用，避免重复加载 9 份语法。
- 结果缓存：`language + '\0' + text`，最多 96 条，key 长度总量上限 2,000,000。
- 单块代码超过 200,000 UTF-16 code units 返回 `null`；单行分词 500ms 预算。
- 主题或括号开关变化时清空结果缓存。

### 3.4 编辑模式（实时预览 / 源码）

- 使用 CodeMirror `ViewPlugin`，通过 `editorInfoField` 确认 Markdown 文件。
- 文档变化时重新提取围栏（文档 > 2,000,000 code units 跳过）。
- 只处理与 `visibleRanges` 相交的代码块。
- 用 `syntaxTree(state)` + `tokenClassNodeProp` 确认 `hmd-codeblock`，排除 `hmd-comment`。
- `view.domAtPos()` 将源码区间映射为 DOM `Range`。
- 校验 `range.toString() === state.sliceDoc(from, to)`，不一致则跳过。
- 不向编辑器添加 span，不改原生 Token 类。
- 主题切换时通过 `StateEffect` 触发 ViewPlugin 重新测量；先清空所有视图的旧范围，避免隐藏视图残留旧颜色。
- 显式跳过 `view.dom.ownerDocument !== document` 的独立窗口；pop-out 不支持。

### 3.5 阅读模式

- `registerMarkdownPostProcessor` 优先级 100，处理 `pre > code[class*="language-"]`。
- 排除 frontmatter、未知语言；用 `ctx.getSectionInfo(code)` 和源 Markdown 围栏位置确认归属。
- 使用 `StaticRange` + `CSS.highlights`，不替换 Prism DOM。
- 每个已确认的 `code` 节点附加子树 `MutationObserver`，监听 `childList` / `characterData`，处理 Prism 异步替换文本节点。
- `MarkdownRenderChild` 在段落卸载时清除范围和 observer。
- 主题切换时重新遍历已跟踪的 code 节点，清空旧范围并按新主题重建；断开节点的范围会被清理，后续重新渲染时由 postprocessor 重新处理。

### 3.6 高亮注册与动态 CSS

- 名称格式：`aof-reading-<lighthex>-<darkhex>`；编辑和阅读共用。
- 按颜色对共享 `Highlight` 对象；为空时从 `CSS.highlights` 删除。
- `highlight-style.cjs` 生成：

```css
.theme-light .markdown-rendered pre > code::highlight(NAME),
.theme-light .markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock:not(.HyperMD-codeblock-begin):not(.HyperMD-codeblock-end)::highlight(NAME) { color: #...; }
.theme-dark ... { color: #...; }
```

- 只声明 `color`；实机 CSSOM 审计 46 条规则，属性只有 `color`。
- 静态 `styles.css` 不含 `::highlight`，不命中笔记代码。

### 3.7 设置、命令、持久化

- `settings.cjs` 默认值：`{light:'atom-one-light', dark:'atom-one-dark', coloredBrackets:true}`。
- 非法 ID、错误外观、旧字段（`lightTheme`/`darkTheme`）自动规范化。
- 设置页 `SyntaxThemeSettingTab`：预设、浅色、深色、彩色括号、状态、双预览。
- 命令：`choose-syntax-theme`、`open-syntax-theme-settings`。
- `updateSettings()` 使用串行 Promise 队列，避免快速连续修改竞态；成功后 `saveData`。
- `refreshDecorations()`：
  1. 清空所有 editor 范围；
  2. 重建已跟踪的阅读范围；
  3. 重建动态样式；
  4. 对所有编辑器视图 dispatch refresh effect；
  5. 更新设置页状态和预览。
- 设置页在 Obsidian 1.14.4 是 popout 窗口；`app.setting.open()` + `openTabById()` 打开。命令弹窗在活动窗口打开。

### 3.8 卸载与恢复

- `onunload()` 设置 `active=false`，清理阅读 observer/范围、editor 范围、palettes、动态样式，dispose 引擎。
- 禁用后实机检查：`aof` highlights = 0、无新增 span、代码文字/字体/样式/几何不变、笔记内容不变。
- 重新启用后高亮恢复。

---

## 4. 文件与接口速查

### 4.1 主题目录结构

```json
{
  "formatVersion": 1,
  "defaults": { "light": "atom-one-light", "dark": "atom-one-dark" },
  "families": [
    {
      "id": "github",
      "name": "GitHub",
      "presets": { "light": "github-light-default", "dark": "github-dark-default" }
    }
  ],
  "themes": {
    "github-light-default": {
      "id": "github-light-default",
      "family": "github",
      "name": "GitHub Light Default",
      "appearance": "light",
      "foreground": "#1F2328",
      "tokenColors": [
        { "scope": ["comment"], "foreground": "#6E7781" }
      ]
    }
  }
}
```

### 4.2 设置数据

`data.json`：

```json
{
  "light": "github-light-default",
  "dark": "catppuccin-mocha",
  "coloredBrackets": true
}
```

### 4.3 引擎输出

```js
[
  [
    { from: 0, to: 6, light: '#A626A4', dark: '#C678DD' }
  ]
]
```

坐标是 JavaScript 字符串 / DOM / CodeMirror 的 UTF-16 下标，不是 UTF-8 字节。

---

## 5. 构建、打包、安装

### 5.1 命令

```sh
npm ci
npm run verify        # 主题资产 --check + 26 项自动化测试
npm run build         # plugin/atom-one-fenced-syntax/
npm run package       # ZIP + ZIP SHA-256
npm run verify-build  # 产物、许可证、哈希、路径泄漏、ZIP
```

`npm run prepare-themes`：主题快照变化后重新生成资产。
`npm run prepare-assets`：从本机 VS Code 更新语法快照，普通构建不需要。

### 5.2 构建产物

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

`manifest.json`：

```json
{
  "id": "atom-one-fenced-syntax",
  "name": "Atom One Fenced Syntax",
  "version": "0.2.0",
  "minAppVersion": "1.14.0",
  "isDesktopOnly": true
}
```

### 5.3 安装路径

用户实际库使用 `.obsidian-mac`：

```text
.obsidian-mac/plugins/atom-one-fenced-syntax/
```

ZIP 内含顶层 `atom-one-fenced-syntax/` 文件夹。解压后应直接得到该文件夹，而不是 `atom-one-fenced-syntax 2` 或嵌套两层。

### 5.4 当前用户安装状态（重要）

截至本文整理时：

- 旧版 0.1.0 仍在：
  `.../.obsidian-mac/plugins/atom-one-fenced-syntax/`
- 新版 0.2.0 在：
  `.../.obsidian-mac/plugins/atom-one-fenced-syntax 2/`
- `community-plugins.json` 已包含 `atom-one-fenced-syntax`，插件已启用；`atom-one-fenced-syntax 2/data.json` 已生成，说明当前加载的是新版文件夹。
- 目录名带空格和 “2” 是 macOS 解压重名造成的；两个文件夹的 `manifest.json` 使用同一个插件 ID，属于重复安装，后续升级容易混乱。
- 之前尝试自动重命名时，文件沙箱升级被用户拒绝，因此**没有对用户目录做任何修改**。

建议的安全整理步骤（需要用户手动执行或明确授权）：

1. 完全退出 Obsidian（Cmd+Q）。
2. 打开 Finder 到 `.obsidian-mac/plugins/`。
3. 把旧 `atom-one-fenced-syntax` 重命名为 `atom-one-fenced-syntax-0.1.0-backup`。
4. 把 `atom-one-fenced-syntax 2` 重命名为 `atom-one-fenced-syntax`。
5. 重新打开 Obsidian；插件应自动从正确目录加载，`data.json` 随文件夹一起保留。
6. 如果未自动启用，在第三方插件中打开开关。
7. 左侧“第三方插件”下会出现 **Atom One Fenced Syntax**，点击进入语法配色设置。

不要删除旧文件夹，除非确认不需要回滚 0.1.0。

---

## 6. 测试与证据

### 6.1 自动化测试

命令：`npm run verify`，结果 **26/26 通过**。

覆盖：

- Atom One 0.1.0 九个语言样本全量输出快照（`atom-one-baseline.json`）；
- 17 个主题的官方 comment/keyword/string/number 颜色；
- 浅色/深色独立；
- 彩色括号开关；
- 主题切换缓存失效；
- 损坏主题回退；
- 17 个主题、6 个家族、预设合法性、Dracula 无浅色；
- 源文件 SHA-256、许可证哈希、归一化资产哈希；
- 设置规范化、旧字段、非法 ID、外观错配；
- 动态 CSS 只含 `color`；
- 静态 UI CSS 不命中笔记代码；
- 生成资产 `--check` 无漂移。

证据：`evidence/v0.2.0/automated-tests.txt`。

### 6.2 隔离 Obsidian 实机测试

环境：macOS、Obsidian 1.14.4、Minimal 9.1.4。测试库和 profile 都在 `/tmp`，**没有覆盖用户实际库**；测试完成后已清理。

10 个阶段全部通过：

| 阶段 | 结果 |
| --- | --- |
| prepare | 插件 0.2.0 加载，引擎就绪 |
| accuracy | 17/17 主题真实 DOM 计算色与官方值一致 |
| matrix | 3 主题组合 × 2 外观 × 3 视图 × 6 语言 = 108 项，0 失败 |
| boundary | 主题切换/禁用/恢复的样式、几何、HTML、范围交叉检查通过 |
| editing | 实时预览 + 源码滚动六种代码块；42→41→42 更新并恢复 |
| settingsUI | 3 个下拉、7/6/11 选项、预设、括号、双预览、状态均通过 |
| commandModal | 两个命令存在；弹窗打开/取消正常 |
| performance | 12 次切换约 1.35s；无泄漏；缓存/注册表有界 |
| fallback | 非法主题 ID 回退 Atom One，保留 `coloredBrackets:false` |
| persistence | 重启后 GitHub Light Default / Catppuccin Mocha + 括号关闭保留 |

关键数字：

- 动态 CSS 46 条规则，属性只有 `color`；
- 阅读/编辑范围无空文本；
- 笔记内容 `noteUnchanged:true`；
- 高亮/调色板无增长泄漏；
- 重启后 Token 实际色 `rgb(5, 80, 174)`。

证据：

- `evidence/v0.2.0/real-obsidian-results.json`
- `evidence/v0.2.0/real-obsidian-run.log`
- `evidence/v0.2.0/settings-light.png` / `settings-dark.png`
- `evidence/v0.2.0/note-light-github-catppuccin.png` / `note-dark-github-catppuccin.png`
- `evidence/v0.2.0/reading-light-ayu-dracula.png` / `reading-dark-ayu-dracula.png`
- `evidence/v0.2.0/command-modal.png`

测试脚本：`tools/obsidian-v0.2.0-test.cjs`（CDP；不自动安装到用户库）。

### 6.3 证据级别

- **自动化测试**：Node 环境，不是 Obsidian 实机。
- **隔离 Obsidian 实机**：真实 Obsidian 1.14.4，独立测试库/profile。
- **未验证**：Windows、iOS、Android、pop-out、社区商店安装流程、长期内存/CPU 压测。

不要把前两类证据当成未验证平台的证明。

---

## 7. 已知问题、风险与遗留项

### 7.1 Obsidian 宿主行为

调试时用一个“只注册空 Markdown 后处理器”的对照插件复现过：Obsidian 1.14.4 在特定时序下禁用该插件后，实时预览原生 Markdown 小部件可能被宿主移除；切换阅读模式或重开笔记后恢复。最终完整套件未复现（`hostWidgetRemoval:false`）。

结论：

- 这不是本插件样式或主题颜色造成的；
- 若用户遇到，切换一次阅读模式/重新打开笔记即可恢复；
- 不要据此修改插件去操作原生 DOM。

### 7.2 平台

- `isDesktopOnly: true`；
- 运行时通过 Node `fs` 读取独立 `onig.wasm`；
- iOS/Android 不能只改 `isDesktopOnly` 就可用；
- Windows 未实机验证。

### 7.3 宿主内部 API 风险

以下依赖不是稳定公开 API，未来 Obsidian 版本可能变化：

- `editorInfoField`；
- `tokenClassNodeProp`；
- `previewMode.rerender(true)`；
- `app.setting.open()` / `openTabById()`；
- CodeMirror `visibleRanges` / `domAtPos` 行为；
- Obsidian 的 `.theme-light` / `.theme-dark` body 类。

升级 Obsidian 后必须重跑实机边界和阅读虚拟滚动测试。

### 7.4 主题与性能

- 首次切换到未缓存主题仍需重建一侧 9 份语法，实机约 1–2 秒；注册表缓存 1 个/侧，来回切换才快。
- 主题源快照更新后必须运行 `npm run prepare-themes` 和 `npm run verify`；否则资产会漂移。
- 只做 TextMate；Pylance/LSP、语义 Token、用户自定义 VS Code 规则不覆盖。
- pop-out 未适配；阅读/编辑分支会跳过非主窗口。
- 大文件保护沿用 0.1.0：单块 200,000 字符、文档 2,000,000 字符、单行 500ms。
- 独立 `onig.wasm` 仍是社区商店交付的潜在障碍；本次未上架。

### 7.5 当前安装目录重复

见 5.4。建议整理，但不影响当前运行。

---

## 8. 需求追溯矩阵

| # | 需求 | 实现位置 | 测试证据 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 6 系列 17 变体 | `themes.json`、`themes.cjs` | 26 自动化 + accuracy 17/17 | 通过 |
| 2 | 官方真实配色 | `sources/themes/`、`theme-provenance.json` | 源文件/SHA/许可证测试 | 通过 |
| 3 | 离线可用 | 构建打包主题 + wasm | 构建/实机 | 通过 |
| 4 | 保留 Atom One | akamud 快照 | 9 样本逐字节基线 | 通过 |
| 5 | 浅/深独立 | `settings.cjs`、engine 双 Registry | accuracy + matrix | 通过 |
| 6 | 自动跟随外观 | `.theme-light/.theme-dark` CSS | boundary + matrix | 通过 |
| 7 | 快速预设 | `applyPreset()` | settingsUI | 通过 |
| 8 | Dracula 仅深色 | catalog/preset | settingsUI 保留浅色 | 通过 |
| 9 | 设置页 | `SyntaxThemeSettingTab` | settingsUI + 截图 | 通过 |
| 10 | 命令面板 | 2 个 command | commandModal | 通过 |
| 11 | 当前状态展示 | `syncControls()` | settingsUI | 通过 |
| 12 | 彩色括号开关 | `coloredBrackets` | settingsUI + editing | 通过 |
| 13 | 简洁预览 | `renderPreview()` | settingsUI 56 spans | 通过 |
| 14 | 立即应用 | `updateSettings()` | matrix/boundary | 通过 |
| 15 | 持久化 | `saveData/loadData` | persistence 重启 | 通过 |
| 16 | 切换无残留 | `refreshDecorations()` | boundary/matrix | 通过 |
| 17 | 不改 Markdown | 无写入 | `noteUnchanged:true` | 通过 |
| 18 | 失败回退 | `engine.setThemes` 回退 | fallback | 通过 |
| 19 | 只改前景色 | dynamic CSS + UI scope | CSSOM 46 规则 | 通过 |
| 20 | 禁用恢复 | `onunload` | boundary highlights=0 | 通过 |
| 21 | 保留六语言 | grammars/canonical | matrix 108 项 | 通过 |
| 22 | 性能稳定 | 结果缓存 + 注册表缓存 | performance 12 次 1.35s | 通过 |
| 23 | 非目标未扩张 | 代码/依赖检查 | 构建检查 | 通过 |
| 24 | 不覆盖用户配置 | 测试隔离 | 用户 0.1.0 未被覆盖 | 通过 |

---

## 9. 接手检查清单

### 第一步：确认基线

```sh
cd /path/to/obsidian-syntax-palette
npm run verify
npm run build
npm run verify-build
```

### 第二步：读代码

优先：

1. `plugin-src/main.cjs`
2. `plugin-src/engine.cjs`
3. `plugin-src/themes.cjs`
4. `plugin-src/settings.cjs`
5. `plugin-src/highlight-style.cjs`
6. `plugin-src/fences.cjs`

### 第三步：明确任务类型

- **修 bug**：先复现，再判断属于编辑、阅读、主题、设置、构建哪一层。
- **加主题**：更新 `sources/themes/sources.json` + 快照 + 许可证 → `prepare-themes` → 测试 → 实机。
- **改 UI**：只改 `.aof-*` 作用域；跑 settingsUI/commandModal 实机。
- **改范围/生命周期**：必须重跑 boundary、editing、reading、persistence。
- **移动端/商店**：先解决 wasm 交付和 Node API；不要只改 manifest。

### 第四步：禁止事项

- 不要直接改用户已安装插件或用户 `.obsidian-mac` 配置；安装/升级必须备份。
- 不要凭记忆重建主题；必须用 `sources/` 官方快照。
- 不要扩大样式范围（背景、字体、边框、行高、span 包装）。
- 不要改插件 ID / 显示名称 / 整体品牌。
- 不要在没有真实 Obsidian 证据时宣称 Windows/iOS 兼容。
- 不要把自动化测试或隔离实机测试说成用户实际环境测试。
- 不要公开发布或上传远程仓库（用户未授权）。

### 第五步：当前最可能需要做的事

1. 帮用户整理重复安装目录（见 5.4），或确认当前 `atom-one-fenced-syntax 2` 运行状态。
2. 如果要做下一版本：优先补 Windows 实机、pop-out、商店 wasm 交付、长期性能。
3. 如果用户报告颜色不刷新：先检查 `refreshDecorations()` 和阅读 observer，再跑 boundary。
4. 如果用户报告设置页不出现：先确认插件开关是否启用；启用后设置项在左侧“第三方插件”分组底部。

---

## 10. 命令速查

```sh
# 测试与主题资产
npm run verify
npm run check-themes
npm test

# 构建与打包
npm run build
npm run package
npm run verify-build

# 更新主题资产（修改 sources 后）
npm run prepare-themes

# 更新语法快照（仅开发机，需要本机 VS Code）
npm run prepare-assets
```

关键路径：

```text
plugin-src/main.cjs
plugin-src/engine.cjs
plugin-src/themes.cjs
plugin-src/settings.cjs
plugin-src/highlight-style.cjs
plugin-src/fences.cjs
sources/themes/sources.json
tools/prepare-theme-assets.cjs
tools/build-plugin.cjs
tools/package-plugin.cjs
tools/verify-build.cjs
tools/obsidian-v0.2.0-test.cjs
evidence/v0.2.0/real-obsidian-results.json
```

---

## 11. 版本与来源

| 主题项目 | 版本 |
| --- | --- |
| akamud/vscode-theme-onelight | 2.3.0 |
| akamud/vscode-theme-onedark | 2.3.0 |
| GitHub.github-vscode-theme | 6.3.5 |
| teabyii.ayu | 1.5.0 |
| Microsoft VS Code theme-defaults | 1.142.0 |
| Catppuccin.catppuccin-vsc | 3.19.0 |
| dracula-theme.theme-dracula | 2.25.1 |

全部主题使用 MIT 许可证；完整文本在 `sources/licenses/` 和构建产物 `THIRD-PARTY-NOTICES.txt`。

---

## 12. 安全整理当前重复安装目录

仅供有文件权限的人执行。不要在执行前删除任何文件夹。

```sh
VAULT_CONFIG_DIR="/path/to/your-vault/.obsidian-mac"
cd "$VAULT_CONFIG_DIR/plugins"

# 1. 退出 Obsidian 后再执行。
# 2. 备份旧版，保留回滚能力。
mv "atom-one-fenced-syntax" "atom-one-fenced-syntax-0.1.0-backup"

# 3. 把新版改为规范目录名。
mv "atom-one-fenced-syntax 2" "atom-one-fenced-syntax"

# 4. 检查
ls -ld atom-one-fenced-syntax atom-one-fenced-syntax-0.1.0-backup
cat atom-one-fenced-syntax/manifest.json
```

然后重新打开 Obsidian，确认第三方插件开关已开启，左侧“第三方插件”下出现 **Atom One Fenced Syntax**。

---

## 13. 最后提醒

- 当前代码、测试、构建产物和 ZIP 是一致的；ZIP 已校验。
- 任何后续修改都必须重新跑 `npm run verify`、`npm run build`、`npm run package`、`npm run verify-build`。
- 涉及视觉范围或生命周期时，必须重新跑真实 Obsidian，不接受只看 Node 测试。
- 任何主题更新都必须保留来源、版本、许可证和哈希；不能凭印象改颜色。
