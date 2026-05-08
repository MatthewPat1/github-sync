# GitHub Sync

GitHub Sync is a desktop-only Obsidian plugin foundation for syncing a vault with a GitHub repository through the local `git` binary.

This repository currently contains the plugin lifecycle, settings model, git service wrapper skeleton, sync manager lock skeleton, status bar controller, settings tab, conflict modal placeholder, and utility helpers. Full sync behavior is intentionally not implemented yet.

## Development

- `npm run dev` starts the esbuild watcher.
- `npm run build` type-checks and bundles the plugin.

Because this plugin uses Node APIs, `manifest.json` sets `isDesktopOnly` to `true`.
