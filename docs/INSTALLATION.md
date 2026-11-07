# Syntax Palette installation

Syntax Palette 0.5.9 is an Obsidian plugin by Frank:
https://github.com/bilibilijojo

Check GitHub releases and the Obsidian Community Plugins directory for the
current publication status.

## Manual installation

After a release is published, download `main.js`, `manifest.json`, and
`styles.css` from:
https://github.com/bilibilijojo/obsidian-syntax-palette/releases

For a local source build, run `npm ci` and `npm run package` in the repository,
and use those same files from `plugin/syntax-palette/`.

1. Create `.obsidian/plugins/syntax-palette/` inside your vault.
2. Copy the three files into that folder.
3. Reload Obsidian and enable Syntax Palette under Settings → Community plugins.
4. Open Syntax Palette settings to choose light and dark palettes and optional
   backgrounds, line numbers, colored brackets, and editor wrapping.

The syntax engine and its WASM payload are embedded in `main.js`. No separate
`onig.wasm` or dependency download is required. Third-party notices are embedded
in `main.js`; the ZIP also contains full license and provenance documents.

Mobile installation is enabled as an experimental target; iOS, iPadOS, and
Android still require real-device validation, including touch scrolling,
selection, keyboard input, and rotation. macOS has been tested with Obsidian
1.14.5; Windows and Linux have not been tested on real systems. Pop-out windows
are unsupported.

For the optimized mobile block-scrolling path, use Obsidian 1.15.0 (the host
version checked for this candidate). Older supported hosts retain the
compatibility scrolling path when their editor lacks block-wrapper support.

For mobile testing, use a separate test vault and copy the three build files
into its plugin folder, without replacing an existing `data.json`. Check both
editing and reading views, theme changes, line numbers, wrapping, horizontal and
vertical touch scrolling, selection and copy/paste, keyboard composition,
rotation, app restart, and disabling the plugin. Test on each target platform;
a desktop WebView or a narrow desktop viewport is not mobile acceptance.

Project-authored code that the owner is entitled to license uses Apache-2.0.
Third-party resources retain their original licenses.
