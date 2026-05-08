# Project Instructions

This is a desktop-only Obsidian plugin written in TypeScript.

The plugin syncs an Obsidian vault with GitHub using the local git binary. It must be safe, conservative, and never overwrite user data automatically.

Core rules:
- Use TypeScript.
- Use Obsidian Plugin API.
- Use Node child_process.spawn, not shell-string exec.
- Do not auto-resolve Git conflicts.
- Do not silently overwrite files.
- Do not store GitHub tokens.
- Do not manage SSH keys.
- Redact secrets from logs before displaying them.
- Keep code modular and testable.
- Prefer small classes with clear responsibilities.

Important Obsidian requirement:
- Because this plugin uses Node APIs, manifest.json must set "isDesktopOnly": true.

Feature priorities:
1. Git service wrapper
2. Safe sync queue/lock
3. Pull with rebase + autostash
4. Status bar
5. Ribbon buttons
6. Command palette commands
7. Settings tab
8. Conflict detection modal
9. .gitignore writer
10. .gitattributes writer
11. Git binary auto-detection
12. Startup pull delay
13. Error categories
14. Secret redaction
15. Device name in commit messages

Build commands:
- npm run build
- npm run dev

