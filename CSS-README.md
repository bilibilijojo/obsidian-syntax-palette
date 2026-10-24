# Obsidian Atom One 围栏代码语法颜色

交付文件为 `atom-one-syntax.css`。它只声明 `color` 和私有的 `--aos-*` 颜色变量，不覆盖 Obsidian 或 Minimal 的任何全局颜色变量，也没有背景、字体、字号、字重、行高、边框、圆角、阴影及间距声明。

## 使用

1. 当前 macOS 配置目录是 `.obsidian-mac`，应将 `atom-one-syntax.css` 放入 `.obsidian-mac/snippets/`。此前误放到 `.obsidian/snippets/`，已在本次纠正；安装状态见 `evidence/installation.json`。
2. 在 Obsidian 的「设置 → 外观 → CSS 代码片段」刷新列表，开启 `atom-one-syntax`。
3. 浅色模式自动使用 One Light，深色模式自动使用 One Dark，不需要修改 Minimal Theme Settings，也不要求 Minimal 的配色方案切换为 Atom。
4. 恢复时关闭这一个 Snippet。无需重新安装主题或恢复其他文件。

开启／关闭 Snippet 是 Obsidian 的设置操作，会更新已有的 `appearance.json`。本次不代为改写该文件，因此安装文件与开启开关是分开的。

实际库中已新增独立验收笔记 `Temporary/Atom One Syntax Acceptance - Codex.md`，内容与本目录 `acceptance.md` 一致。它已用于实机测试，测试标签页结束后关闭，原笔记界面已恢复。

## 目录纠正

用户截图显示 Obsidian 打开的是 `.obsidian-mac/snippets`。初次交付误将默认 `.obsidian` 当作实际配置目录，且因此检查了另一份 Minimal 9.0.2。本次按 `.obsidian-mac` 中的 Minimal 9.1.4 重新检查和测试。旧配置目录的检查记录保留在来源文件中，不作为当前配置证据。

## 依据与本地分析

- 安装版本：Obsidian 1.14.4、Minimal 9.1.4。
- 检查了本地 `Minimal/theme.css`、`manifest.json`、`appearance.json`、Minimal Theme Settings 的 `data.json` ；此前另一个配置目录中的 `Color.css` 不属于当前配置。
- 读取了本地 Obsidian 1.14.4 ASAR 中的 `app.css`、代码块解析逻辑、CodeMirror 语言模式与 Prism。
- Minimal 的 Atom 方案定义的是通用主题颜色；语法高亮主要沿用 Obsidian 自带的 `--code-*` 变量。直接在根节点覆盖这些变量可能影响其他语法组件，因此本 Snippet 不采取该方式。
- 当前配置文件中浅色方案为 `minimal-atom-light`，深色方案为 `minimal-solarized-dark`。两项都不修改。
- 实时预览和源码模式均使用 CM6 的稳定命名类：`HyperMD-codeblock`、`cm-hmd-codeblock` 和 `cm-keyword` 等。起止围栏行与语言标签被排除。
- 阅读模式限定在 `.markdown-rendered .el-pre > pre:not(.frontmatter) > code[class*="language-"]` 内。排除 frontmatter、行内代码、无语言类的缩进代码，以及无 Obsidian 原生块包装的其他组件。

上游配色定义于 2026-10-18 从 GitHub 官方 API 取得，原文件保存在 `sources/`，blob SHA 和 SHA-256 记录在 `sources/provenance.json`。使用 JSON 的 `colors.editor.foreground` 与 `tokenColors[].settings.foreground`；不导入其中的背景、斜体、粗体或其他编辑器 UI 配置。

| 分类 | One Light | One Dark |
| --- | --- | --- |
| 默认代码文字 | `#383A42` | `#ABB2BF` |
| 注释 | `#A0A1A7` | `#5C6370` |
| 关键字 | `#A626A4` | `#C678DD` |
| 字符串 | `#50A14F` | `#98C379` |
| 数字 | `#986801` | `#D19A66` |
| 函数名 | `#4078F2` | `#61AFEF` |
| 类名 | `#C18401` | `#E5C07B` |
| 变量／标签名 | `#E45649` | `#E06C75` |
| 属性名 | `#986801` | `#D19A66` |
| 内建函数／正则 | `#0184BC` | `#56B6C2` |

这是可用语义分类的映射表，并不表示每个解析器都能识别出所有分类。

## CSS 能力边界

VS Code 使用 TextMate scope（以及可选的语义高亮），Obsidian 编辑器使用 CodeMirror，阅读模式使用 Prism。配色值可以准确提取，Token 分类无法保证相同。

- 编辑模式中，Python 的类名和函数定义都可能是 `cm-def`，Bash 的变量定义也可能是 `cm-def`。此 Snippet 将 `cm-def` 映射为函数色，因此这些类名和 Shell 变量会与原主题存在分类差异。CSS 无法根据 Token 文本判断语义。
- 编辑模式中，普通变量统一保留 Atom One 默认文字色；`cm-variable-3` / `cm-type` 使用类／类型色；`cm-property` 使用默认文字色；同时带 `cm-string.cm-property` 的带引号键名使用变量红色。这是对共享 Token 分类的保守映射。
- 编辑模式中的 JavaScript 方法可能只有 `cm-property`，函数调用未必有独立 Token，因此不能承诺所有函数调用呈蓝色。Python 参数、布尔值、CSS 关键字等细分类同样受现有 Token 限制。
- 阅读模式的 JSON 键名、布尔值／null、JS 运算符、CSS 属性名、HTML 属性引号及等号有独立规则。Prism 的组合类，例如 `function property-access`，也经过测试处理。
- 不使用 DOM 文本匹配、不依赖 CodeMirror 生成的动态类、不通过插件补充语义。
- 阅读模式中没有语言标记的围栏代码保持原样，以避免覆盖与其外观相同的缩进代码。无法用纯 CSS 从没有来源标记的相同 DOM 区分这些情况。
- 选择器面向 Obsidian 原生块包装。改变 DOM 的第三方代码块插件、直接复用同一 DOM 的原始 HTML、未来版本的结构变动，不属于已验证范围；不增加全局兜底选择器。

## 验证结果与证据等级

实机检查已完成：在正在运行的 Obsidian 1.14.4 / Minimal 9.1.4 中，使用实际 MarkdownView、真实 CM6 编辑器及原生阅读视图，覆盖两种外观 × 三种视图 × 六种语言，共 36 组。记录 1,266 个实际 Token，完成 1,028 项既定颜色映射断言。详见 `evidence/live-acceptance.md`、`evidence/live-summary.json` 和原始测量 `evidence/live-results.json`。

此前的独立浏览器回归测试仍保留在 `evidence/verification-summary.json` 与 `evidence/browser-results.json`。用户截图中的 Python 分类差异见 `evidence/python-comparison.md`。所有通过结论均指既定映射及隔离性，不代表恢复 VS Code 的完整语义分类。

| 项目 | 结果 | 证据范围 |
| --- | --- | --- |
| Python、JavaScript、JSON、Bash、HTML、CSS | 实机通过既定映射验收 | 每种语言在浅深色、三种真实视图中分别取样 |
| 两种外观的既定映射颜色 | 实机通过 | 1,028 项计算颜色断言，无不匹配 |
| 实时预览／源码的选择器与层叠 | 实机通过 | 验证真实视图状态以及 is-live-preview 标志 |
| 阅读模式 Token 映射 | 实机通过 | 按原生阅读视图的虚拟化滚动位置取样 |
| 背景、字体、字重、行高、间距、尺寸等 | 实机未发现变化 | 比较实际视图内全部已渲染元素的计算样式与边界尺寸 |
| 行内代码、正文、链接、引用、围栏标记 | 实机未发现范围外变化 | 所有直接颜色变化均位于允许的代码内容选择器内 |
| frontmatter、外部组件负样本 | 独立回归通过 | 另见浏览器负样本测试，未将该部分冒称为实机样本 |
| 禁用后恢复 | 实机通过 | 暂停实际加载的 CSSStyleSheet 后重新启用，测量值恢复 |
| Minimal 原文件、Minimal 设置、外观配置、app.json、已安装 CSS | 本轮前后 SHA-256 一致 | Snippet 已由用户启用；本轮不改写这些配置 |
| 笔记打开记录与工作区状态 | 正常变化 | Obsidian 记录了验收笔记的打开和关闭，workspace.json 因此变化 |

浏览器中部分属性默认引用 `currentColor`，如 `-webkit-text-fill-color`、边框的计算颜色等，会随文字颜色自动产生派生数值变化。测试将这些派生颜色与直接 `color` 变化分别处理；背景、边框宽度／样式、字体、布局等仍逐项比较。Snippet 不声明这些派生属性。

实机验收以临时切换 body 上的原生 theme-light/theme-dark 类和实际样式表的 disabled 状态实现；不写入保存的外观选项，不更改 Minimal 配色方案，不安装插件。此项验证的是外观类驱动的浅深色分支，不包含 macOS 系统外观事件的触发测试。结束时恢复原浅色外观、实时预览状态及 Snippet 启用状态，并关闭开发者工具。源码模式与阅读模式的实际截图分别为 `evidence/live-light-source.png` 和 `evidence/live-dark-reading.png`。

## 复现

```sh
python3 tools/build_snippet.py
python3 tools/extract_runtime.py
python3 tools/serve_fixture.py
```

在浏览器打开 `http://127.0.0.1:8766/`，页面自动运行并将证据写回本工作目录。之后另开终端执行：

```sh
python3 tools/verify_results.py
```

服务器只监听本机回环地址，且仅开放指定测试资源。`extract_runtime.py` 只读取安装包并将运行时副本提取到 `/tmp/obsidian-runtime`。`tools/`、`sources/`、`evidence/` 和验收笔记均无需复制到库；实际使用只需一个 CSS 文件。

## 来源

- [Minimal](https://github.com/kepano/obsidian-minimal)
- [One Light 的实际定义](https://github.com/akamud/vscode-theme-onelight/blob/master/themes/OneLight.json)
- [One Dark 的实际定义](https://github.com/akamud/vscode-theme-onedark/blob/master/themes/OneDark.json)

上游 JSON 快照归各项目作者所有，保留其名称、来源及 Git blob 标识用于核对。
