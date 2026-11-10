# Release and Community Plugins submission

Status: local preparation. Check the current remote release and Community
Plugins listing before taking publication steps.

The current source version is **0.5.11**. The manifest, package, lockfile, tag,
and release must agree, with no `v` prefix on the tag. Never replace an existing
tag or release. Mobile support is experimental and has not received real-device
acceptance; verify it on the intended target platforms before describing it as
fully supported.

## Owner review before publication

Review [license status](release/LICENSE-AUDIT.md) and
[release status](release/RELEASE-AUDIT.md). Confirm the unresolved rights and
attribution scope, the final file list, and explicit authorization to make the
repository public, publish a release, and submit the plugin. Frank is already
confirmed as the public author; this alone does not establish copyright ownership.

## Build and prepare

```sh
npm ci
npm run verify
npm run check-release-metadata -- --for-release
npm run package
npm run verify-build
```

The current release notes are [0.5.11.md](releases/0.5.11.md). Standard release attachments:

- `plugin/syntax-palette/main.js`
- `plugin/syntax-palette/manifest.json`
- `plugin/syntax-palette/styles.css`

The ZIP, its SHA-256 sidecar, and full third-party notices can be supplementary
attachments. They must never become extra installation dependencies.

The draft workflow is manual only and requires an existing matching tag,
explicit authorization, a public repository, and successful verification. It
creates a draft, which still needs a separate reviewed publication action.
Ordinary pushes and tag creation do not publish releases. Hosted Actions have
not yet been run for this release.

## Publish and submit after owner authorization

1. Push the reviewed commit normally; verify the default branch is `main`.
2. Make `bilibilijojo/obsidian-syntax-palette` public.
3. Recheck remote tags/releases; create the new tag at the reviewed commit.
4. Publish the matching GitHub release with the three standard assets and
   verify the downloaded files against the local candidate's checksums.
5. Sign in at https://community.obsidian.md with the owner's Obsidian account.
6. Link the GitHub account and add `bilibilijojo/obsidian-syntax-palette`.
7. Confirm the directory reads the committed default-branch manifest, submit,
   and record the actual review response. The plugin ID must be unique; local
   validation does not prove directory availability.
8. Resolve actual automated review errors. If a new release is needed, increment
   the version and create a new tag; never overwrite the old release or tag.
9. Describe the plugin as store-installable only after approval/publication is
   confirmed by the directory. Update both README availability sections then.

Authentication is performed through GitHub/Obsidian's own login and authorization
flows. Do not place passwords or access tokens in source, commands, or reports.

## Official references

Checked against the official pages on 2026-10-24:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)

The official submission guide now directs initial submissions to the Community
directory website. It requires a release tag matching the manifest and reads the
manifest at the default branch HEAD; the release is required in addition to source.
