# Theme provenance and licenses / 主题来源与许可证

本插件内置 **15 个主题系列、39 个配色变体**。仓库中的 `sources/` 保存官方主题快照（部分原始文件为 JSONC，保留注释和尾逗号），`sources/themes/sources.json` 保存精确来源，`sources/theme-provenance.json` 保存每个源文件、许可证、归一化主题的 SHA-256，以及官方 `editor.foreground` / `editor.background` 的提取结果。

## 变体清单

下表“源文件 SHA-256”是实际纳入仓库的原始主题文件的 SHA-256 前 12 位；“许可证”列指向 `sources/licenses/` 中的完整文本。完整 64 位哈希见 `sources/theme-provenance.json`。

| 变体 | 系列 | 外观 | 版本 | 源文件 SHA-256（前 12 位） | 许可证 |
| --- | --- | --- | --- | --- | --- |
| Atom One Light | atom-one | 浅色 | 2.3.0 | 6628e350875e | MIT |
| Atom One Dark | atom-one | 深色 | 2.3.0 | 9cba08f30e9f | MIT |
| GitHub Light Default | github | 浅色 | 6.3.5 | cc0cf47f4089 | MIT |
| GitHub Dark Default | github | 深色 | 6.3.5 | a81623253b94 | MIT |
| GitHub Dark Dimmed | github | 深色 | 6.3.5 | af4c53a7a780 | MIT |
| Ayu Light | ayu | 浅色 | 1.5.0 | 3d748e7a3666 | MIT |
| Ayu Dark | ayu | 深色 | 1.5.0 | 8782e9876207 | MIT |
| Ayu Mirage | ayu | 深色 | 1.5.0 | e08c742afbbe | MIT |
| VS Code Light+ | vscode | 浅色 | 1.142.0 | fa7d01466a6a | MIT |
| VS Code Dark+ | vscode | 深色 | 1.142.0 | 38db2163183a | MIT |
| VS Code Light Modern | vscode | 浅色 | 1.142.0 | fa7d01466a6a | MIT |
| VS Code Dark Modern | vscode | 深色 | 1.142.0 | 38db2163183a | MIT |
| Catppuccin Latte | catppuccin | 浅色 | 3.19.0 | f819183a518e | MIT |
| Catppuccin Frappé | catppuccin | 深色 | 3.19.0 | 630a590370ff | MIT |
| Catppuccin Macchiato | catppuccin | 深色 | 3.19.0 | 2b96b226a332 | MIT |
| Catppuccin Mocha | catppuccin | 深色 | 3.19.0 | ae9a2cd5944a | MIT |
| Dracula Official | dracula | 深色 | 2.25.1 | ae473d11bdef | MIT |
| Tokyo Night Light | tokyo-night | 浅色 | 1.1.2 | 80273128d232 | MIT |
| Tokyo Night | tokyo-night | 深色 | 1.1.2 | e08d77c898ea | MIT |
| Tokyo Night Storm | tokyo-night | 深色 | 1.1.2 | d190b57f2fa6 | MIT |
| One Dark Pro | one-dark-pro | 深色 | 3.20.3 | 4e6e0d19f8e8 | MIT |
| One Dark Pro Darker | one-dark-pro | 深色 | 3.20.3 | 09d20126b645 | MIT |
| One Dark Pro Flat | one-dark-pro | 深色 | 3.20.3 | dd6bd7c7209e | MIT |
| Light Owl | night-owl | 浅色 | 2.1.1 | 366bafde2804 | MIT |
| Night Owl | night-owl | 深色 | 2.1.1 | 5f7a6aebcb28 | MIT |
| Nord | nord | 深色 | 0.19.0 | 7e307e98bc3a | MIT |
| Solarized Light | solarized | 浅色 | 3.0.0 | 4f57c1aaf23d | MIT |
| Solarized Dark | solarized | 深色 | 3.0.0 | e9526b405bbf | MIT |
| Kanagawa Lotus | kanagawa | 浅色 | 1.2.0 | 1fcb340d05d7 | MIT |
| Kanagawa Wave | kanagawa | 深色 | 1.2.0 | 41d3f2c40b75 | MIT |
| Kanagawa Dragon | kanagawa | 深色 | 1.2.0 | d1657717fa6f | MIT |
| Material Theme | material | 深色 | 34.5.0 | 4666ea5560a0 | Apache-2.0 |
| Material Theme Darker | material | 深色 | 34.5.0 | 63b9ea1f44ab | Apache-2.0 |
| Material Theme Palenight | material | 深色 | 34.5.0 | e54792f1273d | Apache-2.0 |
| Material Theme Ocean | material | 深色 | 34.5.0 | b994cc91689f | Apache-2.0 |
| Material Theme Lighter | material | 浅色 | 34.5.0 | e401d34416f9 | Apache-2.0 |
| Monokai | monokai | 深色 | 1.142.0 | 78be641baf2f | MIT |
| Min Light | min | 浅色 | 1.5.0 | 3ad0981e561b | MIT |
| Min Dark | min | 深色 | 1.5.0 | 617a79493262 | MIT |

## 来源项目、版本与分类说明

| 系列 / 来源 | 版本 | 来源项目 | 类型与说明 |
| --- | --- | --- | --- |
| Atom One | 2.3.0 | https://github.com/akamud/vscode-theme-onelight<br>https://github.com/akamud/vscode-theme-onedark | 官方主题快照；既有 v0.1.0 基线 |
| GitHub | 6.3.5 | https://github.com/primer/github-vscode-theme<br>Marketplace `GitHub.github-vscode-theme` | 官方 VSIX 发布包 |
| Ayu | 1.5.0 | https://github.com/ayu-theme/vscode-ayu<br>Marketplace `teabyii.ayu` | 官方 VSIX 发布包 |
| VS Code Official | 1.142.0（commit `6d62b1d5dace`） | Microsoft VS Code 内置 `theme-defaults` | 官方内置主题，按 include 链合并 |
| Catppuccin | 3.19.0 | https://github.com/catppuccin/vscode<br>Marketplace `Catppuccin.catppuccin-vsc` | 官方 VSIX 发布包 |
| Dracula | 2.25.1 | https://github.com/dracula/visual-studio-code<br>Marketplace `dracula-theme.theme-dracula` | 官方 VSIX 发布包；仅深色 |
| Tokyo Night | 1.1.2 | https://github.com/tokyo-night/tokyo-night-vscode-theme<br>Marketplace `enkia.tokyo-night` | 官方 VSIX 发布包。Light 文件在官方扩展中注册为 `uiTheme: "vs"`，编辑器背景为 `#E6E7ED`；JSON 的 `type` 字段误写为 `dark`，分类以官方浅色变体和实际背景为准 |
| One Dark Pro | 3.20.3 | https://github.com/Binaryify/OneDark-Pro<br>Marketplace `zhuangtongfa.Material-theme` | 官方 VSIX 发布包。Marketplace ID 沿用历史名称，但显示名是 One Dark Pro；全部为深色 |
| Night Owl | 2.1.1 | https://github.com/sdras/night-owl-vscode-theme<br>Marketplace `sdras.night-owl` | 官方 VSIX 发布包。官方浅色标签为 `Night Owl Light`，本插件显示为 Light Owl |
| Nord | 0.19.0 | https://github.com/nordtheme/visual-studio-code<br>Marketplace `arcticicestudio.nord-visual-studio-code` | 官方 VSIX 发布包；仅深色 |
| Solarized | 3.0.0 | https://github.com/ryanolsonx/vscode-solarized-theme<br>Marketplace `ryanolsonx.solarized` | **第三方 VS Code 移植版**，MIT；基于 Ethan Schoonover 的 Solarized 调色板。不是原作者发布的 VS Code 官方包。Light 文件的 JSON `type` 字段同样误写为 `dark`，但扩展注册为浅色且背景为 `#FDF6E3`，故归为浅色 |
| Kanagawa | 1.2.0 | https://github.com/paccodes/kanagawa-vscode-theme<br>Marketplace `metaphore.kanagawa-vscode-color-theme` | **第三方 VS Code 移植版（Kanagawa Flavors）**，MIT；包含 Wave、Dragon、Lotus，并在 README 中署名上游 [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim) |
| Material Theme | **34.5.0** | Marketplace `Equinusocio.vsc-material-theme`；历史仓库 https://github.com/material-theme/vsc-material-theme；保留副本 https://github.com/antfu/vsc-material-theme | **冻结的官方 Apache-2.0 发布版**。34.5.0 的 `package.json` 和 LICENSE 均确认 Apache-2.0；后续 34.7.x 改为限制性 Material Theme/Vira 条款，未使用。包含 Default、Darker、Palenight、Ocean、Lighter，不含 High Contrast / Deepforest |
| Monokai | 1.142.0（commit `6d62b1d5dace`） | Microsoft VS Code 内置 `theme-monokai` | 经典 VS Code 内置 Monokai；仅深色 |
| Min Theme | 1.5.0 | https://github.com/miguelsolorio/min-theme<br>Marketplace `miguelsolorio.min-theme` | 官方 VSIX 发布包。Min Dark 未定义 `colors["editor.foreground"]`，按 VS Code TextMate 规则使用官方首个默认 Token 前景色 `#B392F0`，并在 provenance 中记录 `foregroundSource: "tokenColors.default"` |

### 明确未收录

- Gruvbox
- Rosé Pine
- Everforest

这些系列未出现在主题资产、下拉菜单或构建产物中。

### One Dark Pro Flat 的说明

One Dark Pro Flat 与 One Dark Pro 的 Token 前景色和 `editor.background` 完全相同（`#ABB2BF` / `#282C34` 等），差异仅在 VS Code 工作台 UI 的扁平化。插件不读取工作台 UI，因此在本插件中两者显示的语法颜色和背景一致。保留 Flat 是因为 v0.3.0 需求明确点名该官方变体；它不被用来虚增“有效颜色规则”数量，来源和等同性在此公开记录。

## 官方背景色提取

v0.3.0 允许用户选择使用主题的 **原生编辑器背景**。每个变体只从同一个官方主题实例提取：

- `colors.editor.background`
- `colors.editor.foreground`（若缺失，按 VS Code TextMate 规则使用官方默认 Token 前景色）
- `tokenColors[].settings.foreground`

不会：

- 从其他变体借背景；
- 用另一深浅方向的主题替代；
- 根据截图或记忆编造颜色；
- 提取字体样式、UI 主题色或语义 Token 颜色。

如果主题没有有效 `editor.background`，`themes.json` 中记录为 `null`，运行时不为该侧生成背景规则，由 Obsidian 保留原生背景。当前 39 个变体均有有效官方背景；对应值由自动化测试和真实 Obsidian 检查逐项核对。

## 快照与校验

- 原始主题快照：`sources/themes/`，以及 `sources/OneLight.json`、`sources/OneDark.json`。
- 人工维护来源清单：`sources/themes/sources.json`。
- 生成的来源报告：`sources/theme-provenance.json`，包含：
  - 每个源文件（含 include 链）的 SHA-256；
  - 许可证文件 SHA-256；
  - `editor.foreground` / `editor.background`；
  - `foregroundSource` / `backgroundSource`；
  - 归一化主题的 SHA-256；
  - VSIX 版本、下载 URL 和归档 SHA-256（新增系列）。
- 生成器：`tools/prepare-theme-assets.cjs`。
- `npm run check-themes` 会验证生成资产和来源报告没有漂移。

## 许可证文件

| 文件 | 项目 |
| --- | --- |
| `sources/licenses/akamud-vscode-theme-onelight-MIT.txt` | Atom One Light（akamud） |
| `sources/licenses/akamud-vscode-theme-onedark-MIT.txt` | Atom One Dark（akamud） |
| `sources/licenses/github-vscode-theme-MIT.txt` | GitHub Theme for VS Code（Primer） |
| `sources/licenses/ayu-vscode-MIT.txt` | Ayu for VS Code（Ike Kurghinyan） |
| `sources/licenses/catppuccin-vscode-MIT.txt` | Catppuccin for VS Code |
| `sources/licenses/dracula-vscode-MIT.txt` | Dracula Theme for VS Code |
| `sources/licenses/vscode-MIT.txt` | Microsoft VS Code `theme-defaults` / `theme-monokai` |
| `sources/licenses/tokyo-night-MIT.txt` | Tokyo Night for VS Code（Enkia） |
| `sources/licenses/one-dark-pro-MIT.txt` | One Dark Pro（Binaryify） |
| `sources/licenses/night-owl-MIT.txt` | Night Owl（Sarah Drasner） |
| `sources/licenses/nord-MIT.txt` | Nord for VS Code（Arctic Ice Studio / Sven Greb） |
| `sources/licenses/solarized-vscode-MIT.txt` | Solarized for VS Code（Ryan Olson） |
| `sources/licenses/solarized-upstream-MIT.txt` | Solarized 调色板（Ethan Schoonover） |
| `sources/licenses/kanagawa-vscode-MIT.txt` | Kanagawa Flavors for VS Code（Pierre-Alain Castella） |
| `sources/licenses/kanagawa-nvim-MIT.txt` | Kanagawa.nvim（rebelot） |
| `sources/licenses/material-theme-Apache-2.0.txt` | Material Theme 34.5.0 官方发布包 |
| `sources/licenses/min-theme-MIT.txt` | Min Theme（Miguel Solorio） |

构建产物中的 `THIRD-PARTY-NOTICES.txt` 汇总以上主题许可证、语法定义许可证和运行时依赖许可证。

## 彩色括号

彩色括号是独立可关闭的插件功能，使用 VS Code 括号配对默认色，不来自上述主题文件，也不随背景开关改变：

| 模式 | 第 1 层 | 第 2 层 | 第 3 层 |
| --- | --- | --- | --- |
| Light | `#0431FA` | `#319331` | `#7B3814` |
| Dark | `#FFD700` | `#DA70D6` | `#179FFF` |

## 重新生成

```sh
npm run prepare-themes
npm run check-themes
npm run verify
npm run build
npm run package
npm run verify-build
```

更新主题来源时必须同时更新原始快照、许可证和 `sources/themes/sources.json`；不要手工修改 `plugin-src/assets/themes.json`。
