# Development

Use the Node.js version in `.nvmrc` and the committed npm lockfile.

```sh
npm ci
npm run verify
npm run package
npm run verify-build
```

`npm run verify` checks all 39 theme variants, license notices, project metadata,
and the core automated tests. Packaging builds the plugin and creates a ZIP with
fixed timestamps, plus a SHA-256 sidecar. No production resources are downloaded
at build time.

## Source layout

- `plugin-src/`: production plugin source and bundled runtime assets.
- `plugin-src/tests/`: core regression tests and their fixtures.
- `sources/`: vendored original themes, provenance, full licenses, and notices.
- `tools/`: build, packaging, provenance checks, and desktop regression helpers.
- `docs/images/`: genuine screenshots referenced by the user README.
- `docs/release/`: license and release review status.
- `docs/releases/`: prepared release descriptions.
- `.github/workflows/`: read-only CI and an explicitly authorized draft release job.

Build output under `plugin/`, ZIPs, release staging files, dependencies, and local
verification evidence are ignored by Git. The root manifest is the source of
truth for install metadata and is copied unchanged into the package.

## Verification baseline

The existing core suite has 85 passing tests. Previous macOS Obsidian 1.14.5
verification covered 26 full functionality phases, including every theme,
settings persistence, highlighting, backgrounds, line numbers, wrapping,
independent scrolling, disable/reenable, and preservation of note text. A later
fresh-vault startup check verified Frank's public credit and the standard
three-file install with embedded WASM. Windows and Linux remain untested.

The repository cleanup reruns only the lightweight source/build checks needed
to detect missing build inputs or broken document paths. It does not repeat the
large real-app suite or change its claims.

## Contributions and licenses

Discuss proposed changes in an issue first. Preserve tests and original
third-party copyright/license text. Do not add new theme snapshots without
recording their source, version, hashes, license, and redistribution obligations.
See [theme provenance](THEME-PROVENANCE.md) and
[license review](release/LICENSE-AUDIT.md).

Historical development journals and one-off local audit tools were backed up
outside the project before removal. They are not required to build or inspect
the current plugin. Existing Git history has not been rewritten.
