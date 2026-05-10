# GitHub Sync

GitHub Sync is a desktop-only Obsidian plugin for syncing a vault with a GitHub repository through the local `git` binary.

The plugin runs local Git commands from the vault folder. It does not create GitHub repositories, store GitHub tokens, manage SSH keys, or replace Git authentication setup.

## Setting up a vault repository

The Obsidian vault folder itself should be initialized as the Git repository. In other words, the folder that contains your notes should also contain the `.git` folder after setup.

For most personal vaults, the GitHub repository should be private. Vaults often contain personal notes, drafts, attachments, and settings that are not meant to be public.

Create `.gitignore` before the first commit so temporary workspace files are not tracked. Create `.gitattributes` before the first commit so line endings and binary files are handled consistently from the start. You can use the plugin commands `GitHub Sync: Write .gitignore` and `GitHub Sync: Write .gitattributes`, or create the files yourself.

You can use either SSH or HTTPS remote URLs:

- SSH example: `git@github.com:USER/REPO.git`
- HTTPS example: `https://github.com/USER/REPO.git`

The plugin expects Git authentication to already work in your terminal. If `git pull`, `git push`, or `git ls-remote origin` fails in the terminal, fix that first. The plugin does not create GitHub repositories or manage SSH keys.

Recommended plugin settings:

- `remoteName`: `origin`
- `branchName`: `main`

### Initialize a new vault repo

Run these commands from inside your Obsidian vault folder:

```bash
cd /path/to/YourVault
git init
git branch -M main
```

Create `.gitignore` and `.gitattributes` before the first commit. If creating them manually, use content similar to the plugin defaults.

```bash
cat > .gitignore <<'EOF'
.DS_Store
Thumbs.db
desktop.ini
.trash/
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache/
EOF

cat > .gitattributes <<'EOF'
* text=auto eol=lf
*.md text eol=lf
*.canvas text eol=lf
*.json text eol=lf
*.css text eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.webp binary
*.pdf binary
*.zip binary
EOF
```

Stage and commit the first version:

```bash
git add .
git commit -m "Initial vault commit"
```

### Add a GitHub remote

Create an empty private repository on GitHub first. Do not initialize it with a README if you already committed locally.

Then add the remote from your vault folder. Use either SSH:

```bash
git remote add origin git@github.com:USER/REPO.git
```

Or HTTPS:

```bash
git remote add origin https://github.com/USER/REPO.git
```

Verify the remote:

```bash
git remote -v
git ls-remote origin
```

### Push the first commit

```bash
git push -u origin main
```

After this succeeds, configure GitHub Sync with `remoteName` set to `origin` and `branchName` set to `main`.

### Clone onto a second machine

On the second machine, make sure Git authentication works first. Then clone the repository into the folder where you want the vault to live.

Using SSH:

```bash
cd /path/to/Obsidian/Vaults
git clone git@github.com:USER/REPO.git YourVault
```

Using HTTPS:

```bash
cd /path/to/Obsidian/Vaults
git clone https://github.com/USER/REPO.git YourVault
```

Open `YourVault` as a vault in Obsidian, install or copy the plugin into `.obsidian/plugins/github-sync`, enable it, and confirm the plugin settings use:

- `remoteName`: `origin`
- `branchName`: `main`

## Troubleshooting

### Git not found

Install Git and confirm it works in a terminal:

```bash
git --version
```

If Git is installed but the plugin cannot find it, set the Git binary path in the plugin settings. Common macOS paths include `/opt/homebrew/bin/git`, `/usr/local/bin/git`, and `/usr/bin/git`.

### Remote already exists

If `git remote add origin ...` says the remote already exists, inspect it:

```bash
git remote -v
```

To change it:

```bash
git remote set-url origin git@github.com:USER/REPO.git
```

Or for HTTPS:

```bash
git remote set-url origin https://github.com/USER/REPO.git
```

### Authentication failed

First verify the same command works in your terminal:

```bash
git ls-remote origin
```

For SSH, make sure your SSH key is added to GitHub and your local SSH agent. For HTTPS, use GitHub-supported credential manager authentication or a personal access token through your Git credential helper. The plugin does not store tokens or manage SSH keys.

### Push rejected

A push rejection usually means the remote has commits your local vault does not have yet. Pull first, resolve any conflicts, then push again:

```bash
git pull --rebase --autostash origin main
git push origin main
```

If the plugin reports push rejected, run Pull or Sync again after checking the terminal output.

### Merge conflict

A conflict means Git needs you to edit files manually. Open the conflicted files, remove conflict markers, keep the correct content, then stage the resolved files:

```bash
git status
git diff --name-only --diff-filter=U
git add path/to/resolved-file.md
```

If Git says a rebase or merge is in progress, finish it in the terminal with the command Git recommends, such as:

```bash
git rebase --continue
```

or:

```bash
git merge --continue
```

The plugin will not choose ours/theirs, overwrite files, or automatically resolve conflicts.

### Wrong branch name

Check your current branch:

```bash
git branch --show-current
```

Check remote branches:

```bash
git branch -r
```

If your repository uses `master` or another branch name instead of `main`, update the plugin `branchName` setting to match, or rename your branch intentionally in Git.

## Development

- `npm run dev` starts the esbuild watcher.
- `npm run build` type-checks and bundles the plugin.
- `npm run package` builds a personal distribution zip in `dist/`.

Because this plugin uses Node APIs, `manifest.json` sets `isDesktopOnly` to `true`.
