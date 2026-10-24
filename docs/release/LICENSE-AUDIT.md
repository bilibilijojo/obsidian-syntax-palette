# Syntax Palette License Audit

**Reviewed:** 2026-10-24
**Status:** license files and notices are prepared; the project is **not yet cleared for public release** because the copyright and contribution authority for project-authored code still needs the owner’s confirmation.

This is a source and distribution audit, not a legal opinion. Unknown rights are recorded as unknown rather than inferred from a Git author field or from AI-generated-code status.

## Scope and method

The review covered the current Git history and working tree; plugin and historical CSS source; the 39 checked-in theme snapshots and their source records; 11 bundled TextMate grammar files; the package lock and installed dependency tree; the generated `main.js`, Community Plugins install file set, and ZIP candidate; and the existing license and notice texts.

The reproducibility checks run for this audit were `npm ci`, `npm run verify`, `npm run package`, `npm run verify-build`, and `npm audit`. The clean install used the committed lockfile. The pre-cleanup history reviewed consists of `fd4760b` and `cf8fd31`, both attributed to `bilibilijojo`; that records Git identity only and does not establish ownership of every line in the tree. Historical development documents and the earlier CSS implementation have since been backed up outside the project; their existing Git history is retained.

The review also checked the exact Material Theme 34.5.0 Marketplace archive referenced by the provenance record. Its decompressed VSIX SHA-256 is `91bb3a0d8935355c0a8e74eadc01dc1b2027e715177f0c81b0b2005c2187d8a0`; the archive contains `extension/LICENSE.txt`, reports version `34.5.0` and `Apache-2.0`, and has no separate `NOTICE` file. Its license text matches `sources/licenses/material-theme-Apache-2.0.txt` byte-for-byte. The marketplace package URL and source hash are recorded in [`sources/themes/sources.json`](../../sources/themes/sources.json).

## Project code and Apache-2.0

The project owner has selected Apache License 2.0 for Syntax Palette code the owner is entitled to license. The root [`LICENSE`](../../LICENSE) is byte-for-byte identical to the [Apache Software Foundation’s official License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt), SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. The appendix contains the standard illustrative copyright example and is intentionally unchanged. It is not a project-specific copyright assertion or a requirement to replace the Apache license text. No legal copyright holder has been inferred from the public author name.

SPDX identifiers have been added to project source and build files where appropriate. [`plugin-src/fences.cjs`](../../plugin-src/fences.cjs) remains marked MIT because it is a documented port of markdown-it block-rule behavior; the upstream MIT text and attribution are retained. Third-party theme and grammar data are not relabeled as project-owned Apache code.

**Rights not established by this review:** several AI coding agents contributed to the project, and the repository does not contain a per-file contribution/assignment record or the applicable agreements and service terms. The two Git commits do not identify those contributions. The historical CSS implementation and any adaptations from public code also need owner review against their source history. AI-generated code is not assumed to be automatically public domain or automatically owned by the repository owner.

Before public release, the owner must confirm which project-authored files they have the right to license under Apache-2.0 and provide the exact copyright-holder text to use in project attribution. Until then, the Apache license declaration is prepared but not independently cleared for all project-authored content.

## Theme snapshots

All 39 variants are mapped to immutable local source-file and normalized-asset hashes in [`sources/theme-provenance.json`](../../sources/theme-provenance.json). `npm run check-themes` verifies that the generated catalog is still 39 variants across 15 families and that source, license, and normalized-asset hashes have not drifted.

| Included variants | Upstream source and version | License |
| --- | --- | --- |
| Atom One Light, Atom One Dark | akamud/vscode-theme-onelight and vscode-theme-onedark 2.3.0 | MIT |
| GitHub Light Default, GitHub Dark Default, GitHub Dark Dimmed | GitHub.github-vscode-theme 6.3.5 | MIT |
| Ayu Light, Ayu Dark, Ayu Mirage | teabyii.ayu 1.5.0 | MIT |
| VS Code Light+, VS Code Dark+, VS Code Light Modern, VS Code Dark Modern | Microsoft VS Code 1.142.0, commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1` | MIT |
| Catppuccin Latte, Frappé, Macchiato, Mocha | Catppuccin.catppuccin-vsc 3.19.0 | MIT |
| Dracula Official | dracula-theme.theme-dracula 2.25.1 | MIT |
| Tokyo Night Light, Tokyo Night, Tokyo Night Storm | enkia/tokyo-night-vscode-theme 1.1.2 | MIT |
| One Dark Pro, One Dark Pro Darker, One Dark Pro Flat | Binaryify/OneDark-Pro 3.20.3 | MIT |
| Light Owl, Night Owl | sdras/night-owl-vscode-theme 2.1.1 | MIT |
| Nord | nordtheme/visual-studio-code 0.19.0 | MIT |
| Solarized Light, Solarized Dark | ryanolsonx/vscode-solarized-theme 3.0.0; a third-party VS Code port | MIT |
| Kanagawa Lotus, Kanagawa Wave, Kanagawa Dragon | paccodes/kanagawa-vscode-theme 1.2.0; a third-party VS Code port based on Kanagawa.nvim | MIT |
| Material Theme, Darker, Palenight, Ocean, Lighter | Equinusocio.vsc-material-theme 34.5.0, exact Marketplace archive hash above | Apache-2.0 |
| Monokai | Microsoft VS Code 1.142.0, commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1` | MIT |
| Min Light, Min Dark | miguelsolorio/min-theme 1.5.0 | MIT |

The Material Theme snapshots are frozen from 34.5.0. No later 34.7.x/Vira release is included. One Dark Pro Flat has the same plugin-visible token colors as One Dark Pro; the variant is retained because it was explicitly requested and its source license is preserved. Solarized and Kanagawa are identified as third-party VS Code ports rather than represented as original upstream releases.

## Grammars, runtime, and build dependencies

The 11 bundled TextMate grammar files are tracked in [`sources/plugin-grammar-provenance.json`](../../sources/plugin-grammar-provenance.json) with upstream paths, versions, and hashes. Their original copyright and license statements are retained in [`sources/grammar-licenses.txt`](../../sources/grammar-licenses.txt) and the generated third-party notice.

| Component | Version and license | Included in the end-user plugin? |
| --- | --- | --- |
| vscode-textmate | 9.2.0, MIT | Bundled into `main.js` |
| vscode-oniguruma | 2.0.1, MIT | Bundled into `main.js` |
| Embedded Oniguruma WASM engine | 6.9.5_rev1, BSD-2-Clause | Embedded in `main.js`; upstream notice is retained verbatim |
| esbuild | 0.25.12, MIT | Development/build tool only |
| @esbuild platform packages | 0.25.12, MIT, optional by platform | Development/build tool only |
| markdown-it | 14.3.3, MIT | Test oracle only; not bundled. Its ported block-rule behavior in `fences.cjs` retains MIT attribution |

The locked markdown-it test dependency was updated from vulnerable 14.1.0 to 14.3.3; `npm audit` then reported zero vulnerabilities. Its locked transitive development packages are `argparse` 2.0.1 (Python-2.0), `entities` 4.5.0 (BSD-2-Clause), `linkify-it` 5.0.2 (MIT), `mdurl` 2.1.0 (MIT), `punycode.js` 2.3.1 (MIT), and `uc.micro` 2.1.0 (MIT). They are not part of the production bundle. The `package-lock.json` is the authoritative version list.

## Notices and distribution

[`THIRD-PARTY-NOTICES.txt`](../../THIRD-PARTY-NOTICES.txt) is generated from the pinned theme and grammar provenance, vendored full license texts, and the installed locked runtime dependencies. `npm run check-notices` rejects stale notices or changed dependency license text. The build embeds the notice in `main.js`; the ZIP also includes the notice file. This keeps required third-party notices available when Obsidian installs only the standard plugin assets.

No project-level `NOTICE` file was added: the project’s Apache license does not require inventing a notice or copyright attribution, and the verified Material Theme archive has no separate NOTICE file. The upstream `vscode-oniguruma` `NOTICES.txt`, including the BSD-2-Clause Oniguruma notice, is retained under `sources/notices/` and included verbatim in the generated distribution notice.

## Remaining license review items

1. Owner confirmation of the rights to license AI-assisted and historical project code, including the earlier CSS version and any externally adapted code.
2. Owner-supplied copyright-holder wording for the Apache-2.0 project attribution. The public author name **Frank** and homepage `https://github.com/bilibilijojo` have been confirmed and set in the manifest; this project credit does not resolve copyright ownership or licensing authority.
3. A final owner review of the public-facing attribution before changing repository visibility or publishing a release.

The owner has reaffirmed Apache-2.0 for code they are entitled to license. This review records the remaining attribution/authority uncertainties without claiming that every historical contribution has been legally cleared. Public release still requires the owner's final review and authorization.
