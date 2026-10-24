# Syntax Palette

**Syntax Palette** 是一个 Obsidian 桌面插件，只为 Markdown 围栏代码提供语法配色。

| 项目 | 信息 |
| --- | --- |
| 插件 ID | `syntax-palette` |
| 当前开发版本 | `0.5.2` |
| 最低 Obsidian 版本 | `1.14.0` |
| 平台 | 仅桌面版（`isDesktopOnly: true`） |

插件内置 15 个主题系列、39 个配色变体。浅色与深色主题可独立选择；另有彩色括号、代码块背景、行号和编辑视图自动换行选项。关闭自动换行时，每个代码块独立横向滚动。

本项目在首次公开发布前，从内部开发身份 **Atom One Fenced Syntax**（`atom-one-fenced-syntax`）更名。Obsidian 按插件 ID 保存设置，因此旧开发 ID 下的设置不会自动迁移。

## 项目文件

- `manifest.json`：正式插件身份和 Obsidian 元数据。
- `plugin-src/`：插件实现、主题与语法资源、Node 测试。
- `sources/`：上游主题快照、来源记录和完整第三方许可证文本。
- `tools/`：构建、打包、资源准备和验证脚本。
- `PLUGIN-README.md`：安装、设置、限制和故障排查。
- `AI-HANDOFF.md`：架构、验证边界和开发交接。

`plugin/` 下的可安装目录和 ZIP 包由构建生成，不提交到仓库。

## 开发

```sh
npm ci
npm run verify
npm run build
npm run package
npm run verify-build
```

`npm run prepare-assets` 依赖本机 VS Code 扩展文件，不是跨机器初始化步骤。主题 JSON 资源与来源记录已包含在仓库中。

## 验证状态

现有 0.5.2 验收覆盖 macOS Obsidian 和 macOS WKWebView。Windows、Linux 尚未实机验证；iOS、iPadOS 和 Android 不支持。本次仓库准备只调整发布前身份和构建元数据，没有运行构建或测试命令。

## 许可与后续发布

主题和语法资源的第三方许可文本保留在 `sources/licenses/`，构建时会汇总到 `THIRD-PARTY-NOTICES.txt`。正式公开发布或提交社区商店前，还需确定项目自身的许可证和最终作者身份。

社区商店安装流程对单独的 `onig.wasm` 运行时资源仍需确认一个受支持的交付方案；本地 ZIP 能运行不代表商店安装器也会下载该文件。
