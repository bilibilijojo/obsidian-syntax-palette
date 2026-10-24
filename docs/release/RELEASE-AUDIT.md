# Syntax Palette release review

Reviewed 2026-10-24. Status: **prepared for owner release review; not published or submitted**.

## Confirmed release metadata

| Field | Value |
| --- | --- |
| Name / ID | Syntax Palette / `syntax-palette` |
| Public author | Frank |
| Author homepage | https://github.com/bilibilijojo |
| Repository | `bilibilijojo/obsidian-syntax-palette` |
| Initial public version / proposed tag | `0.5.2` / `0.5.2` (no `v` prefix) |
| Minimum Obsidian version | `1.14.5` |
| Desktop only | `true` |
| Project-owned code license | Apache-2.0, within the owner's actual authority |

Public author credit is resolved. Metadata verification checks the root manifest,
package metadata, and built manifest; it does not make a legal ownership finding.
The standard Apache appendix remains unchanged. Third-party themes, grammars,
parser-derived code, runtime dependencies, and embedded Oniguruma retain their
original licenses and notices. A separate invented project NOTICE is unnecessary;
applicable full notices are retained and embedded in `main.js`.

## Remaining publication blockers and owner decisions

1. **Rights and attribution:** the public author name does not establish the legal
   copyright holder or authority over every historical/AI-assisted/adapted file.
   The owner has approved Apache-2.0 for code they can license; the exact scope and
   any project-specific copyright attribution remain unconfirmed. See the
   [license audit](LICENSE-AUDIT.md). Do not relabel third-party content.
2. **Final authorization:** making the repository public, creating the matching
   release/tag, and submitting the plugin require the owner's explicit final
   authorization after reviewing the file list and these findings.
3. **Remote execution:** the current execution environment reported GitHub
   authentication/API connection errors. Local preparation can complete; a
   successful authenticated push and hosted CI result have not been claimed.
4. **Directory review:** the plugin ID must be unique and actual automatic review
   errors must be resolved. Directory uniqueness and approval are not confirmed.

A missing public release/tag is a pending authorized publication step, not a
reason to fabricate an approval result. No remote history is to be overwritten.

## Repository cleanup and history

Historical AI/technical handoffs, version summaries, acceptance journals, early
CSS output/tools, and temporary evidence were backed up outside the project
before removal. The backup contains the original working tree, a full Git
history bundle, file inventory, checksums, and the previous real-app evidence.
Current production source, all vendored resources/licenses, core tests, current
regression helpers, screenshots, and Actions are retained.

The pre-cleanup scan covered two commits and 140 unique file blobs. It found no
matches for the checked personal absolute-path and common credential/private-key
patterns. This is a bounded pattern scan, not proof that all possible secrets
or private information are absent. Existing screenshots were previously reviewed
as synthetic isolated-vault notes and are retained unchanged.

**Old development documents remain accessible in Git history if this repository
becomes public.** Removing them from the current tree does not remove them from
past commits. History has not been rewritten.

## Installation and build checks

The standard install files are `main.js`, `manifest.json`, and `styles.css`.
The build embeds the complete WASM module and third-party notices in `main.js`.
No additional `onig.wasm` is required or included. Root and built metadata must
match exactly. Vendored source files and hashes are checked for all 39 themes.

The existing baseline is 85 passing core tests and an earlier 26-phase macOS
Obsidian 1.14.5 full regression. A subsequent new isolated-vault startup check
verified Frank's loaded credit, the correct homepage, embedded WASM, 39 themes,
and 15 families using only the three standard installation files.

For cleanup, only lightweight source/provenance/notices/metadata tests, document
links, and production packaging checks are repeated. No additional full Obsidian
regression or Windows/Linux device testing is claimed. The cleanup checks passed
85/85 core tests; provenance, notices, release metadata, packaging, and local
Markdown/HTML image paths passed. The executable part of `main.js`, the installer
manifest, and CSS are byte-identical to the prior verified candidate. Embedded-notice changes are limited to the relocated provenance document
reference and removal of an extra blank line at the end; license texts are unchanged. ZIP
timestamps are pinned to UTC as well as a fixed epoch to avoid host-timezone
differences. Final source commit and
asset hashes are recorded in the local release review file list and release
staging directory after the commit is created.

## Nonblocking limitations

- Windows and Linux are desktop targets without real-device acceptance.
- iOS, iPadOS, Android, and pop-out windows are unsupported.
- Genuine README screenshots show the earlier development name; both READMEs
  disclose this. They are not replaced with synthetic product screenshots.
- GitHub Actions have been prepared but have not run on the hosted service for
  this candidate. The CI token is read-only; release creation is manually gated.

## Publication procedure

Follow [the release guide](../RELEASING.md) and the prepared
[release description](../releases/0.5.2.md). The current official guide requires
GitHub source access, a matching release/tag with standard attachments, then
sign-in and GitHub linking at https://community.obsidian.md. It reads the default
branch HEAD manifest. Local checks do not substitute for the directory's result.

Official pages checked on 2026-10-24:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
