# MuseVault

**A home for every spark.**

MuseVault is an open-source, local-first creative artifact library built with React, TypeScript and IndexedDB.

It started with an idea from Dustin: a single repository for his creative artifacts, research and AI-assisted work. This first release is a usable browser application, not a cloud file service.

## Features

- Upload files up to **25 MB each** through quick upload or an artifact form.
- Capture text notes and save HTTP(S) links.
- Organize artifacts by collection, kind, provenance/source and tags.
- Search titles, descriptions, collections, sources and tags.
- Preview images, audio, video, PDFs, and small text/code files.
- Add **immutable file versions**, and download any saved version.
- Back up the whole vault as ZIP, or restore it on another browser/device.
- Safe restore skips existing artifact IDs without overwriting local work.
- Offline-capable app shell after a successful first visit in a compatible browser.
- Configured for GitHub Pages at the /MuseVault/ path.

## Privacy and limitations

**Artifacts are stored in IndexedDB in your current browser profile.** They are not uploaded to GitHub, GitHub Pages, or a server. MuseVault has no accounts, sync, or integrated AI agents in v0.1.

Clearing browser data, using private browsing, losing a device, or storage eviction can **permanently erase your vault**. Export backups regularly and store them safely. Other people with access to your browser profile may be able to access artifacts. Local storage is not encrypted at rest.

Backups are **not encrypted**. MuseVault uses a small original, dependency-free, **uncompressed ZIP** implementation. Restoration supports MuseVault-created ZIP backups only, not general-purpose compressed ZIP archives. ZIP backups are limited to **60 MB**, store a JSON manifest and preserve versions and metadata. Restores check ZIP size, entries, manifest types, declared file sizes and duplicate IDs before writing. Existing IDs are skipped; a restore might partially complete if storage runs out. Don't import untrusted ZIPs.

File previews are best-effort and depend on browser support. Text/code previews are limited to small documents. The offline cache is best-effort and must first be installed online.

## Development

Requires Node.js 22+.

~~~sh
npm install
npm run dev
npm test
npm run build
~~~

## Deployment

GitHub Actions tests/builds pull requests and deploys on pushes to **main**. After merging, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source, if it is not already enabled. Verify that the deployment workflow succeeds.

Expected published URL: https://michaelwave369.github.io/MuseVault/

An Actions run cannot publish Pages if Pages has not been configured. The live URL is not guaranteed until the deployment succeeds.

## Roadmap

1. Explicit artifact lineage relationships and provenance receipts.
2. Streaming backup/export for larger vaults.
3. Permission-controlled import bridges for agent outputs, including metaMuse.
4. Optional opt-in encrypted sync and account capabilities.
5. Browser-based end-to-end tests for version history, restore and offline mode.

## Agent integration boundary

No AI agent can read, write, publish or delete vault artifacts in this release. Future bridges should require scoped user approval, keep write actions reviewable, and record provenance. Do not put tokens or personal artifacts inside the public Pages repository.

## License

MIT © 2026 Michael Hughes and MuseVault contributors.
