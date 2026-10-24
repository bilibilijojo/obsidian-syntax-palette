[English](README.md) · [简体中文](README.zh-CN.md)

# Syntax Palette

**Make code blocks look the way you like.**

Choose a syntax color palette for Markdown code blocks without changing the rest of your Obsidian theme. Your notes, app colors, and other parts of Obsidian keep their usual look.

## See it in Obsidian

<p align="center">
  <img src="docs/images/light-appearance.png" alt="Real Obsidian screenshot showing Syntax Palette colors in a light appearance; Chinese interface." width="49%" />
  <img src="docs/images/dark-appearance.png" alt="Real Obsidian screenshot showing Syntax Palette colors in a dark appearance; Chinese interface." width="49%" />
</p>
<p align="center"><em>Light and dark appearances with different code palettes.</em></p>

<p align="center">
  <img src="docs/images/plugin-settings.png" alt="Real screenshot of the plugin settings page in Obsidian." width="32%" />
</p>
<p align="center"><em>The settings page lets you choose palettes and optional code-block features.</em></p>

These are genuine screenshots from an isolated Obsidian test vault, captured with the v0.5.2 development build before the plugin was renamed from **Atom One Fenced Syntax**. The settings screenshot still shows that earlier name; the code colors and controls shown are real.

## What changes — and what stays the same

Obsidian's theme controls the whole app. Syntax Palette gives Markdown fenced code blocks their own color choices, so you can keep your favorite Obsidian theme and choose code colors that suit you.

The palette applies inside fenced code blocks. It does not recolor regular text or inline code, and it never edits your Markdown content. An optional setting can also change the fenced block's background.

## Choose a palette

Pick from **39 color variants across 15 theme families**, including GitHub, Atom One, Catppuccin, Tokyo Night, Ayu, Dracula, Nord, and more. Choose a light palette and a dark palette separately, so each follows the matching Obsidian appearance.

You can also:

- Turn code-block backgrounds on or off. They are off by default.
- Show line numbers, with each code block starting at 1. They are off by default and are not copied into your notes.
- Choose whether long lines wrap in the editor (off by default). With wrapping off, each code block scrolls horizontally on its own; the rest of the note stays put.
- Keep Obsidian's normal wrapping for regular text. The code-wrapping option only affects fenced code in the editor.

Syntax coloring is available for common languages including Python, JavaScript and TypeScript, JSON, Bash, HTML, and CSS. Unsupported or untagged code blocks keep Obsidian's own syntax colors.

## How to use it

Once Syntax Palette is installed:

1. Open **Settings → Community plugins → Syntax Palette**.
2. Choose a palette for **Light mode** and another for **Dark mode**. You can use a family preset first, then adjust either choice separately.
3. Turn on code-block backgrounds or line numbers if you want them.
4. Set editor code wrapping to match how you like to read long lines.

Changes apply immediately and are saved for your next Obsidian session.

## Availability and installation

Syntax Palette is **not currently listed in Obsidian Community plugins**, and this repository does not yet provide a published installer for the current `syntax-palette` plugin ID. There is no supported end-user installation method yet. The old `atom-one-fenced-syntax` development ZIP is not an installer for this renamed plugin.

The project still needs a verified delivery path for one runtime file before a Community Plugins submission. We will add accurate installation steps here when a release package is available.

## Compatibility and known limits

- Desktop Obsidian only. iOS, iPadOS, and Android are not supported.
- macOS has been tested with Obsidian 1.14.5. Windows and Linux are target platforms but have not yet been tested on those systems.
- Pop-out windows are not supported.
- The 39 built-in palettes cannot be extended with custom theme files.
- When editor wrapping is off, long code lines use horizontal scrolling inside each fenced block.

## For developers

The plugin source is in `plugin-src/`; bundled theme data, source details, and third-party license texts are in `sources/`. See [theme provenance](THEME-PROVENANCE.md) for theme credits and licensing, and [AI-HANDOFF.md](AI-HANDOFF.md) for the development and testing notes.

To build from source:

```sh
npm ci
npm run verify
npm run build
npm run package
npm run verify-build
```

Third-party theme and grammar licenses are included in `sources/licenses/`. A project-wide license and public contribution process have not yet been finalized.
