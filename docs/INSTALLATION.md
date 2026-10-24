# Syntax Palette installation

Syntax Palette 0.5.2 is a desktop Obsidian plugin by Frank:
https://github.com/bilibilijojo

The first public release and Community Plugins listing are pending.

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

Desktop only; macOS has been tested with Obsidian 1.14.5. Windows and Linux have
not been tested on real systems. Mobile devices and pop-out windows are unsupported.

Project-authored code that the owner is entitled to license uses Apache-2.0.
Third-party resources retain their original licenses.
