import { Buffer } from "node:buffer";
import { FSWatcher, promises as fs, watch } from "fs";
import path from "path";
import { Notice, Plugin, TAbstractFile } from "obsidian";
import { GitBinaryDetector } from "./git/GitBinaryDetector";
import { GitService } from "./git/GitService";
import {
	createDefaultIgnorePatterns,
	createDefaultSettings,
	createDefaultWatchPluginReleaseFilesForAutoSync,
	ensureRequiredIgnorePatterns,
	GitHubSyncSettings,
} from "./settings";
import { SyncManager } from "./sync/SyncManager";
import { ConnectionCheckResult, ConnectionTestModal } from "./ui/ConnectionTestModal";
import { ConflictModal } from "./ui/ConflictModal";
import { OverwriteFileModal } from "./ui/OverwriteFileModal";
import { SettingsTab } from "./ui/SettingsTab";
import { StatusBarController } from "./ui/StatusBarController";

export interface SetupChecklistItem {
	id: string;
	label: string;
	passed: boolean;
	detail: string;
}

export default class GitHubSyncPlugin extends Plugin {
	settings: GitHubSyncSettings;
	gitService: GitService;
	syncManager: SyncManager;
	statusBar: StatusBarController;
	private autoSyncTimeoutId: number | null = null;
	private startupPullTimeoutId: number | null = null;
	private pluginWatcherRefreshTimeoutId: number | null = null;
	private readonly pluginGeneratedWritePaths = new Set<string>();
	private readonly pluginGeneratedWriteTimeouts = new Set<number>();
	private readonly pendingAutoSyncPaths = new Set<string>();
	private readonly pendingPluginReleaseScans = new Set<string>();
	private readonly pluginReleaseFileWatchers = new Map<string, FSWatcher>();

	async onload(): Promise<void> {
		await this.loadSettings();

		const gitBinaryDetector = new GitBinaryDetector(this.settings);
		this.gitService = new GitService({
			app: this.app,
			settings: this.settings,
			gitBinaryDetector,
		});
		this.syncManager = new SyncManager({
			settings: this.settings,
			gitService: this.gitService,
		});
		this.statusBar = new StatusBarController(this, this.settings);
		this.registerSyncEventHandlers();

		this.statusBar.showIdle();

		this.addRibbonIcon("cloud-download", "Pull", () => {
			void this.runPullOnly();
		});

		this.addRibbonIcon("refresh-cw", "Sync", () => {
			void this.runSyncNow();
		});

		this.addCommand({
			id: "pull",
			name: "Pull",
			callback: () => {
				void this.runPullOnly();
			},
		});

		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: () => {
				void this.runSyncNow();
			},
		});

		this.addCommand({
			id: "write-gitignore",
			name: "Write .gitignore",
			callback: () => {
				void this.writeGitignore();
			},
		});

		this.addCommand({
			id: "write-gitattributes",
			name: "Write .gitattributes",
			callback: () => {
				void this.writeRootFile(".gitattributes", this.settings.gitattributes);
			},
		});

		this.addCommand({
			id: "test-connection",
			name: "Test connection",
			callback: () => {
				void this.testConnection();
			},
		});

		this.addSettingTab(new SettingsTab(this.app, this));
		this.registerVaultFileEvents();
		await this.setupPluginReleaseFileWatchers();

		if (this.settings.startupPullEnabled) {
			this.startupPullTimeoutId = window.setTimeout(() => {
				void this.syncManager.pullOnly();
			}, this.settings.startupPullDelaySeconds * 1000);
			this.register(() => this.clearStartupPullTimer());
		}
	}

	onunload(): void {
		this.clearAutoSyncTimer();
		this.clearStartupPullTimer();
		this.clearPluginWatcherRefreshTimer();
		this.closePluginReleaseFileWatchers();
		this.pendingPluginReleaseScans.clear();
		for (const timeoutId of this.pluginGeneratedWriteTimeouts) {
			window.clearTimeout(timeoutId);
		}
		this.pluginGeneratedWriteTimeouts.clear();
		this.pluginGeneratedWritePaths.clear();
		this.pendingAutoSyncPaths.clear();
		this.statusBar?.unload();
	}

	async loadSettings(): Promise<void> {
		const loadedSettings = (await this.loadData()) as Partial<GitHubSyncSettings> | null;
		this.settings = {
			...createDefaultSettings(this.app.vault.configDir),
			...loadedSettings,
		};
		if (loadedSettings?.watchPluginReleaseFilesForAutoSync === undefined) {
			this.settings.watchPluginReleaseFilesForAutoSync = createDefaultWatchPluginReleaseFilesForAutoSync(
				this.settings.pluginTrackingMode,
			);
		}
		this.settings.ignorePatterns = ensureRequiredIgnorePatterns(
			this.settings.ignorePatterns,
			this.app.vault.configDir,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.statusBar?.refresh(this.settings);
		if (!this.settings.autoSyncEnabled) {
			this.clearAutoSyncTimer();
			this.pendingAutoSyncPaths.clear();
		}
		await this.setupPluginReleaseFileWatchers();
	}

	private async runPullOnly(): Promise<void> {
		const result = await this.syncManager.pullOnly();
		if (result.state === "queued") {
			new Notice("GitHub sync: pull queued.");
		}
	}

	private async runSyncNow(): Promise<void> {
		const result = await this.syncManager.fullSync("manual");
		if (result.state === "queued") {
			new Notice("GitHub sync: sync queued.");
		}
	}

	async testConnection(): Promise<void> {
		const results: ConnectionCheckResult[] = [];

		const gitVersion = await this.gitService.getGitVersion();
		results.push({
			label: "Git binary",
			status: gitVersion.exitCode === 0 ? "pass" : "fail",
			detail: gitVersion.exitCode === 0 ? gitVersion.stdout.trim() : this.getCommandFailureDetail(gitVersion),
		});

		const workTree = await this.gitService.isInsideWorkTree();
		results.push({
			label: "Inside git work tree",
			status: workTree.exitCode === 0 && workTree.value ? "pass" : "fail",
			detail: workTree.exitCode === 0 && workTree.value ? "Vault root is inside a git work tree." : this.getCommandFailureDetail(workTree),
		});

		const branch = await this.gitService.getCurrentBranch();
		const branchName = branch.stdout.trim();
		results.push({
			label: "Current branch",
			status: branch.exitCode === 0 && branchName === this.settings.branchName ? "pass" : "fail",
			detail:
				branch.exitCode === 0
					? `Current branch: ${branchName || "<none>"}. Expected: ${this.settings.branchName}.`
					: this.getCommandFailureDetail(branch),
		});

		const remote = await this.gitService.lsRemote(this.settings.remoteName);
		results.push({
			label: "Remote reachable",
			status: remote.exitCode === 0 ? "pass" : "fail",
			detail: remote.exitCode === 0 ? `Remote '${this.settings.remoteName}' is reachable.` : this.getCommandFailureDetail(remote),
		});

		const userConfigResults = await this.testLocalUserConfig();
		results.push(...userConfigResults);

		new ConnectionTestModal(this.app, results).open();
		if (results.every((result) => result.status !== "fail")) {
			new Notice("GitHub sync: connection test passed.");
			return;
		}

		new Notice("GitHub sync: connection test found issues.");
	}

	async testSetupChecklist(): Promise<SetupChecklistItem[]> {
		const remoteName = this.settings.remoteName.trim() || "origin";
		const branchName = this.settings.branchName.trim() || "main";
		const results: SetupChecklistItem[] = [];

		const gitVersion = await this.gitService.getGitVersion();
		results.push({
			id: "git-binary",
			label: "Git binary found",
			passed: gitVersion.exitCode === 0,
			detail: gitVersion.exitCode === 0 ? gitVersion.stdout.trim() : this.getCommandFailureDetail(gitVersion),
		});

		const workTree = await this.gitService.isInsideWorkTree();
		results.push({
			id: "work-tree",
			label: "Vault folder is a Git repo",
			passed: workTree.exitCode === 0 && workTree.value,
			detail: workTree.exitCode === 0 && workTree.value
				? "The vault root is inside a Git working tree."
				: this.getCommandFailureDetail(workTree),
		});

		const remoteUrl = await this.gitService.getRemoteUrl(remoteName);
		results.push({
			id: "remote-exists",
			label: `Remote ${remoteName} exists`,
			passed: remoteUrl.exitCode === 0 && remoteUrl.stdout.trim().length > 0,
			detail: remoteUrl.exitCode === 0 && remoteUrl.stdout.trim().length > 0
				? `Remote URL is configured for ${remoteName}.`
				: this.getCommandFailureDetail(remoteUrl),
		});

		const currentBranch = await this.gitService.getCurrentBranch();
		const actualBranch = currentBranch.stdout.trim();
		results.push({
			id: "branch-matches",
			label: "Current branch matches configured branch",
			passed: currentBranch.exitCode === 0 && actualBranch === branchName,
			detail: currentBranch.exitCode === 0
				? `Current branch: ${actualBranch || "<none>"}. Configured branch: ${branchName}.`
				: this.getCommandFailureDetail(currentBranch),
		});

		const remoteReachable = await this.gitService.lsRemote(remoteName);
		results.push({
			id: "remote-reachable",
			label: "GitHub remote is reachable",
			passed: remoteReachable.exitCode === 0,
			detail: remoteReachable.exitCode === 0
				? `git ls-remote ${remoteName} succeeded.`
				: this.getCommandFailureDetail(remoteReachable),
		});

		const localName = await this.gitService.getLocalUserName();
		const localEmail = await this.gitService.getLocalUserEmail();
		const hasSettingsUser = this.settings.gitUserName.trim().length > 0 && this.settings.gitUserEmail.trim().length > 0;
		const hasLocalUser = localName.exitCode === 0 && localName.stdout.trim().length > 0 &&
			localEmail.exitCode === 0 && localEmail.stdout.trim().length > 0;
		results.push({
			id: "git-user",
			label: "Git user.name and user.email are configured",
			passed: hasSettingsUser || hasLocalUser,
			detail: hasSettingsUser
				? "Plugin settings provide both Git user name and email."
				: hasLocalUser
					? "Local repository config provides both user.name and user.email."
					: "Set Git user name and email in plugin settings or configure local git user.name and user.email.",
		});

		const gitignoreExists = await this.vaultRootFileExists(".gitignore");
		results.push({
			id: "gitignore",
			label: ".gitignore exists",
			passed: gitignoreExists,
			detail: gitignoreExists ? ".gitignore exists in the vault root." : "Create .gitignore before your first commit.",
		});

		const gitattributesExists = await this.vaultRootFileExists(".gitattributes");
		results.push({
			id: "gitattributes",
			label: ".gitattributes exists",
			passed: gitattributesExists,
			detail: gitattributesExists ? ".gitattributes exists in the vault root." : "Create .gitattributes before your first commit.",
		});

		return results;
	}

	async copyTerminalSetupCommands(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.getTerminalSetupCommands());
			new Notice("GitHub sync: terminal setup commands copied.");
		} catch {
			new Notice("GitHub sync: could not copy terminal setup commands.");
		}
	}

	private async detectGitBinary(): Promise<void> {
		const result = await this.gitService.detectGitBinary();
		if (!result.ok) {
			new Notice(`GitHub sync: ${result.message}`);
			return;
		}

		this.settings.gitBinaryPath = result.path;
		await this.saveSettings();
		new Notice(`GitHub sync: using git at ${result.path}`);
	}

	async writeRootFile(fileName: ".gitignore" | ".gitattributes", content: string): Promise<void> {
		const filePath = path.join(this.gitService.getVaultRootPath(), fileName);
		const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;

		try {
			const existingContent = await fs.readFile(filePath, "utf8");
			if (existingContent === normalizedContent) {
				new Notice(`GitHub sync: ${fileName} is already up to date.`);
				return;
			}

			new OverwriteFileModal(this.app, {
				fileName,
				onConfirm: async () => {
					await this.writeRootFileContent(fileName, filePath, normalizedContent);
				},
			}).open();
		} catch (error) {
			if (!this.isNodeError(error) || error.code !== "ENOENT") {
				new Notice(`GitHub sync: failed to read ${fileName}.`);
				return;
			}

			await this.writeRootFileContent(fileName, filePath, normalizedContent);
		}
	}

	async writeGitignore(): Promise<void> {
		const content = this.getGitignoreContent();
		this.settings.ignorePatterns = content;
		await this.saveSettings();
		await this.writeRootFile(".gitignore", content);
	}

	private async writeRootFileContent(
		fileName: ".gitignore" | ".gitattributes",
		filePath: string,
		content: string,
	): Promise<void> {
		try {
			this.suppressGeneratedWriteEvent(fileName);
			await fs.writeFile(filePath, content, "utf8");
			new Notice(`GitHub sync: wrote ${fileName}.`);
		} catch {
			new Notice(`GitHub sync: failed to write ${fileName}.`);
		}
	}

	private registerSyncEventHandlers(): void {
		this.register(this.syncManager.on("idle", () => this.statusBar.showIdle()));
		this.register(this.syncManager.on("pulling", () => this.statusBar.showPulling()));
		this.register(this.syncManager.on("committing", () => this.statusBar.showCommitting()));
		this.register(this.syncManager.on("pushing", () => this.statusBar.showPushing()));
		this.register(
			this.syncManager.on("synced", (event) => {
				this.statusBar.showSynced();
				if (event.trigger !== "auto") {
					new Notice(`GitHub sync: ${event.message}`);
				}
			}),
		);
		this.register(
			this.syncManager.on("conflict", (event) => {
				this.statusBar.showConflict();
				new Notice(`GitHub sync: ${event.message}`);
				new ConflictModal(this.app, {
					conflictedFiles: event.conflictedFiles ?? [],
					rawResult: event.result,
					vaultPath: this.gitService.getVaultRootPath(),
					getUnresolvedFiles: async () => {
						const result = await this.gitService.getUnmergedFiles();
						return result.values;
					},
					retrySync: async () => {
						const result = await this.syncManager.fullSync("manual");
						if (result.state === "queued") {
							new Notice("GitHub sync: sync queued.");
						}
					},
				}).open();
			}),
		);
		this.register(
			this.syncManager.on("error", (event) => {
				this.statusBar.showError();
				new Notice(`GitHub sync: ${event.message}`);
			}),
		);
	}

	private registerVaultFileEvents(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				this.handleVaultFileEvent(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				this.handleVaultFileEvent(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.handleVaultFileEvent(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.handleVaultFileEvent(file, oldPath);
			}),
		);
	}

	private handleVaultFileEvent(file: TAbstractFile, oldPath?: string): void {
		if (!this.settings.autoSyncEnabled) {
			return;
		}

		if (this.isPluginGeneratedPath(file.path) || (oldPath !== undefined && this.isPluginGeneratedPath(oldPath))) {
			return;
		}

		if (this.isOwnPluginPath(file.path) || (oldPath !== undefined && this.isOwnPluginPath(oldPath))) {
			return;
		}

		this.scheduleAutoSync([file.path, oldPath].filter(isDefined));
	}

	private async setupPluginReleaseFileWatchers(): Promise<void> {
		this.closePluginReleaseFileWatchers();
		if (!this.settings.autoSyncEnabled || !this.settings.watchPluginReleaseFilesForAutoSync) {
			return;
		}

		const pluginRootPath = this.getPluginRootPath();
		try {
			const pluginRootStats = await fs.stat(pluginRootPath);
			if (!pluginRootStats.isDirectory()) {
				return;
			}

			this.watchPluginDirectory(pluginRootPath, (pluginDirectoryName) => {
				this.schedulePluginReleaseWatcherRefresh(pluginDirectoryName);
			});

			const entries = await fs.readdir(pluginRootPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory() || this.isIgnoredPluginDirectory(entry.name)) {
					continue;
				}

				const pluginDirPath = path.join(pluginRootPath, entry.name);
				this.watchPluginDirectory(pluginDirPath, (fileName) => {
					this.handlePluginReleaseFileSystemEvent(entry.name, fileName);
				});
			}
		} catch (error) {
			if (!this.isNodeError(error) || error.code !== "ENOENT") {
				new Notice("GitHub sync: failed to watch plugin release files.");
			}
		}
	}

	private watchPluginDirectory(directoryPath: string, onChange: (fileName: string | null) => void): void {
		try {
			const watcher = watch(directoryPath, (_eventType, fileName) => {
				onChange(this.normalizeWatchedFileName(fileName));
			});
			watcher.on("error", () => {
				watcher.close();
				this.pluginReleaseFileWatchers.delete(directoryPath);
			});
			this.pluginReleaseFileWatchers.set(directoryPath, watcher);
		} catch {
			// Individual plugin folders can disappear while Obsidian is updating plugins.
		}
	}

	private handlePluginReleaseFileSystemEvent(pluginDirectoryName: string, fileName: string | null): void {
		if (!this.settings.autoSyncEnabled || !this.settings.watchPluginReleaseFilesForAutoSync || fileName === null) {
			return;
		}

		if (fileName.includes("/") || fileName.includes(path.sep)) {
			return;
		}

		const vaultPath = `${this.app.vault.configDir}/plugins/${pluginDirectoryName}/${fileName}`;
		if (!this.isAutoSyncablePluginReleasePath(vaultPath)) {
			return;
		}

		this.scheduleAutoSync([vaultPath]);
	}

	private schedulePluginReleaseWatcherRefresh(pluginDirectoryName: string | null): void {
		if (pluginDirectoryName !== null && !this.isIgnoredPluginDirectory(pluginDirectoryName)) {
			this.pendingPluginReleaseScans.add(pluginDirectoryName);
		}

		this.clearPluginWatcherRefreshTimer();
		this.pluginWatcherRefreshTimeoutId = window.setTimeout(() => {
			const pluginDirectoryNames = Array.from(this.pendingPluginReleaseScans);
			this.pendingPluginReleaseScans.clear();
			this.pluginWatcherRefreshTimeoutId = null;
			void this.refreshPluginReleaseFileWatchers(pluginDirectoryNames);
		}, 1000);
	}

	private async refreshPluginReleaseFileWatchers(pluginDirectoryNames: string[]): Promise<void> {
		await this.setupPluginReleaseFileWatchers();
		await this.scheduleExistingPluginReleaseFiles(pluginDirectoryNames);
	}

	private async scheduleExistingPluginReleaseFiles(pluginDirectoryNames: string[]): Promise<void> {
		const changedPaths: string[] = [];
		for (const pluginDirectoryName of pluginDirectoryNames) {
			for (const fileName of this.getPluginReleaseFileNames()) {
				const vaultPath = `${this.app.vault.configDir}/plugins/${pluginDirectoryName}/${fileName}`;
				if (!this.isAutoSyncablePluginReleasePath(vaultPath)) {
					continue;
				}

				const absolutePath = path.join(this.gitService.getVaultRootPath(), vaultPath);
				if (await this.pathExists(absolutePath)) {
					changedPaths.push(vaultPath);
				}
			}
		}

		if (changedPaths.length > 0) {
			this.scheduleAutoSync(changedPaths);
		}
	}

	private closePluginReleaseFileWatchers(): void {
		for (const watcher of this.pluginReleaseFileWatchers.values()) {
			watcher.close();
		}
		this.pluginReleaseFileWatchers.clear();
	}

	private scheduleAutoSync(changedPaths: string[]): void {
		for (const changedPath of changedPaths) {
			this.pendingAutoSyncPaths.add(changedPath);
		}

		this.clearAutoSyncTimer();
		this.autoSyncTimeoutId = window.setTimeout(() => {
			this.autoSyncTimeoutId = null;
			if (!this.settings.autoSyncEnabled) {
				this.pendingAutoSyncPaths.clear();
				return;
			}

			const paths = Array.from(this.pendingAutoSyncPaths);
			this.pendingAutoSyncPaths.clear();
			void this.syncManager.fullSync("auto", paths);
		}, this.settings.idleTimeoutSeconds * 1000);
	}

	private clearAutoSyncTimer(): void {
		if (this.autoSyncTimeoutId === null) {
			return;
		}

		window.clearTimeout(this.autoSyncTimeoutId);
		this.autoSyncTimeoutId = null;
	}

	private clearStartupPullTimer(): void {
		if (this.startupPullTimeoutId === null) {
			return;
		}

		window.clearTimeout(this.startupPullTimeoutId);
		this.startupPullTimeoutId = null;
	}

	private clearPluginWatcherRefreshTimer(): void {
		if (this.pluginWatcherRefreshTimeoutId === null) {
			return;
		}

		window.clearTimeout(this.pluginWatcherRefreshTimeoutId);
		this.pluginWatcherRefreshTimeoutId = null;
	}

	private suppressGeneratedWriteEvent(filePath: string): void {
		this.pluginGeneratedWritePaths.add(filePath);
		const timeoutId = window.setTimeout(() => {
			this.pluginGeneratedWritePaths.delete(filePath);
			this.pluginGeneratedWriteTimeouts.delete(timeoutId);
		}, 2000);
		this.pluginGeneratedWriteTimeouts.add(timeoutId);
	}

	private isPluginGeneratedPath(filePath: string): boolean {
		return this.pluginGeneratedWritePaths.has(filePath);
	}

	private isOwnPluginPath(filePath: string): boolean {
		return filePath === `${this.app.vault.configDir}/plugins/${this.manifest.id}` ||
			filePath.startsWith(`${this.app.vault.configDir}/plugins/${this.manifest.id}/`);
	}

	private isAutoSyncablePluginReleasePath(filePath: string): boolean {
		if (this.isIgnoredManagerPluginPath(filePath) || this.isOwnPluginPath(filePath)) {
			return false;
		}

		const pluginPrefix = `${this.app.vault.configDir}/plugins/`;
		if (!filePath.startsWith(pluginPrefix)) {
			return false;
		}

		const relativePluginPath = filePath.slice(pluginPrefix.length);
		const parts = relativePluginPath.split("/");
		if (parts.length !== 2) {
			return false;
		}

		const fileName = parts[1];
		if (fileName === undefined) {
			return false;
		}

		return this.getPluginReleaseFileNames().includes(fileName);
	}

	private isIgnoredManagerPluginPath(filePath: string): boolean {
		return this.getIgnoredManagerPluginIds().some((pluginId) =>
			filePath === `${this.app.vault.configDir}/plugins/${pluginId}` ||
			filePath.startsWith(`${this.app.vault.configDir}/plugins/${pluginId}/`),
		);
	}

	private isIgnoredPluginDirectory(pluginDirectoryName: string): boolean {
		return this.getIgnoredManagerPluginIds().includes(pluginDirectoryName);
	}

	private getIgnoredManagerPluginIds(): string[] {
		return ["github-sync", "obsidian42-brat", "brat"];
	}

	private getPluginReleaseFileNames(): string[] {
		return ["manifest.json", "main.js", "styles.css"];
	}

	private getPluginRootPath(): string {
		return path.join(this.gitService.getVaultRootPath(), this.app.vault.configDir, "plugins");
	}

	private getGitignoreContent(): string {
		if (this.settings.pluginTrackingMode === "custom") {
			return this.settings.ignorePatterns;
		}

		return createDefaultIgnorePatterns(this.app.vault.configDir, this.settings.pluginTrackingMode);
	}

	private async testLocalUserConfig(): Promise<ConnectionCheckResult[]> {
		const expectedName = this.settings.gitUserName.trim();
		const expectedEmail = this.settings.gitUserEmail.trim();
		if (expectedName.length === 0 && expectedEmail.length === 0) {
			return [
				{
					label: "Local git user config",
					status: "skip",
					detail: "No git user name or email is configured in plugin settings.",
				},
			];
		}

		const results: ConnectionCheckResult[] = [];
		if (expectedName.length > 0) {
			const localName = await this.gitService.getLocalUserName();
			const actualName = localName.stdout.trim();
			results.push({
				label: "Local git user.name",
				status: localName.exitCode === 0 && actualName === expectedName ? "pass" : "fail",
				detail:
					localName.exitCode === 0
						? `Configured: ${actualName || "<none>"}. Expected: ${expectedName}.`
						: this.getCommandFailureDetail(localName),
			});
		}

		if (expectedEmail.length > 0) {
			const localEmail = await this.gitService.getLocalUserEmail();
			const actualEmail = localEmail.stdout.trim();
			results.push({
				label: "Local git user.email",
				status: localEmail.exitCode === 0 && actualEmail === expectedEmail ? "pass" : "fail",
				detail:
					localEmail.exitCode === 0
						? `Configured: ${actualEmail || "<none>"}. Expected: ${expectedEmail}.`
						: this.getCommandFailureDetail(localEmail),
			});
		}

		return results;
	}

	private getCommandFailureDetail(result: { stdout: string; stderr: string; errorCategory?: unknown }): string {
		const detail = result.stderr.trim() || result.stdout.trim();
		if (detail.length > 0) {
			return detail;
		}

		if (typeof result.errorCategory === "string") {
			return result.errorCategory;
		}

		return "Command failed without output.";
	}

	private async vaultRootFileExists(fileName: ".gitignore" | ".gitattributes"): Promise<boolean> {
		try {
			await fs.access(path.join(this.gitService.getVaultRootPath(), fileName));
			return true;
		} catch {
			return false;
		}
	}

	private getTerminalSetupCommands(): string {
		const remoteName = this.settings.remoteName.trim() || "origin";
		const branchName = this.settings.branchName.trim() || "main";
		return [
			"# Run these commands from inside your Obsidian vault folder.",
			"git init",
			`git branch -M ${branchName}`,
			"",
			"cat > .gitignore <<'EOF'",
			this.getGitignoreContent(),
			"EOF",
			"",
			"cat > .gitattributes <<'EOF'",
			this.settings.gitattributes,
			"EOF",
			"",
			"git add .",
			'git commit -m "Initial vault commit"',
			"",
			"# Replace USER/REPO with your GitHub repository.",
			`git remote add ${remoteName} git@github.com:USER/REPO.git`,
			`git push -u ${remoteName} ${branchName}`,
		].join("\n");
	}

	private isNodeError(error: unknown): error is Error & { code?: string } {
		return error instanceof Error;
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private normalizeWatchedFileName(fileName: string | Buffer | null): string | null {
		if (typeof fileName === "string") {
			return fileName;
		}

		if (Buffer.isBuffer(fileName)) {
			return fileName.toString("utf8");
		}

		return null;
	}
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
