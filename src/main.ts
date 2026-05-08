import { promises as fs } from "fs";
import path from "path";
import { Notice, Plugin, TAbstractFile } from "obsidian";
import { GitBinaryDetector } from "./git/GitBinaryDetector";
import { GitService } from "./git/GitService";
import { DEFAULT_SETTINGS, GitHubSyncSettings } from "./settings";
import { SyncManager } from "./sync/SyncManager";
import { ConnectionCheckResult, ConnectionTestModal } from "./ui/ConnectionTestModal";
import { SettingsTab } from "./ui/SettingsTab";
import { StatusBarController } from "./ui/StatusBarController";

export default class GitHubSyncPlugin extends Plugin {
	settings: GitHubSyncSettings;
	gitService: GitService;
	syncManager: SyncManager;
	statusBar: StatusBarController;
	private autoSyncTimeoutId: number | null = null;
	private startupPullTimeoutId: number | null = null;
	private readonly pluginGeneratedWritePaths = new Set<string>();
	private readonly pluginGeneratedWriteTimeouts = new Set<number>();

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

		this.addRibbonIcon("cloud-download", "GitHub Sync: Pull", () => {
			void this.runPullOnly();
		});

		this.addRibbonIcon("refresh-cw", "GitHub Sync: Sync", () => {
			void this.runSyncNow();
		});

		this.addCommand({
			id: "pull",
			name: "GitHub Sync: Pull",
			callback: () => {
				void this.runPullOnly();
			},
		});

		this.addCommand({
			id: "sync-now",
			name: "GitHub Sync: Sync now",
			callback: () => {
				void this.runSyncNow();
			},
		});

		this.addCommand({
			id: "write-gitignore",
			name: "GitHub Sync: Write .gitignore",
			callback: () => {
				void this.writeRootFile(".gitignore", this.settings.ignorePatterns);
			},
		});

		this.addCommand({
			id: "write-gitattributes",
			name: "GitHub Sync: Write .gitattributes",
			callback: () => {
				void this.writeRootFile(".gitattributes", this.settings.gitattributes);
			},
		});

		this.addCommand({
			id: "test-connection",
			name: "GitHub Sync: Test connection",
			callback: () => {
				void this.testConnection();
			},
		});

		this.addSettingTab(new SettingsTab(this.app, this));
		this.registerVaultFileEvents();

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
		for (const timeoutId of this.pluginGeneratedWriteTimeouts) {
			window.clearTimeout(timeoutId);
		}
		this.pluginGeneratedWriteTimeouts.clear();
		this.pluginGeneratedWritePaths.clear();
		this.statusBar?.unload();
	}

	async loadSettings(): Promise<void> {
		const loadedSettings = (await this.loadData()) as Partial<GitHubSyncSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedSettings,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.statusBar?.refresh(this.settings);
		if (!this.settings.autoSyncEnabled) {
			this.clearAutoSyncTimer();
		}
	}

	private async runPullOnly(): Promise<void> {
		const result = await this.syncManager.pullOnly();
		if (result.state === "queued") {
			new Notice("GitHub Sync: pull queued.");
		}
	}

	private async runSyncNow(): Promise<void> {
		const result = await this.syncManager.fullSync("manual");
		if (result.state === "queued") {
			new Notice("GitHub Sync: sync queued.");
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
			new Notice("GitHub Sync: connection test passed.");
			return;
		}

		new Notice("GitHub Sync: connection test found issues.");
	}

	private async detectGitBinary(): Promise<void> {
		const result = await this.gitService.detectGitBinary();
		if (!result.ok) {
			new Notice(`GitHub Sync: ${result.message}`);
			return;
		}

		this.settings.gitBinaryPath = result.path;
		await this.saveSettings();
		new Notice(`GitHub Sync: using git at ${result.path}`);
	}

	async writeRootFile(fileName: ".gitignore" | ".gitattributes", content: string): Promise<void> {
		const filePath = path.join(this.gitService.getVaultRootPath(), fileName);
		const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;

		try {
			const existingContent = await fs.readFile(filePath, "utf8");
			if (existingContent === normalizedContent) {
				new Notice(`GitHub Sync: ${fileName} is already up to date.`);
				return;
			}

			new Notice(`GitHub Sync: ${fileName} already exists and was not overwritten.`);
		} catch (error) {
			if (!this.isNodeError(error) || error.code !== "ENOENT") {
				new Notice(`GitHub Sync: failed to read ${fileName}.`);
				return;
			}

			try {
				this.suppressGeneratedWriteEvent(fileName);
				await fs.writeFile(filePath, normalizedContent, "utf8");
				new Notice(`GitHub Sync: wrote ${fileName}.`);
			} catch {
				new Notice(`GitHub Sync: failed to write ${fileName}.`);
			}
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
					new Notice(`GitHub Sync: ${event.message}`);
				}
			}),
		);
		this.register(
			this.syncManager.on("conflict", (event) => {
				this.statusBar.showConflict();
				new Notice(`GitHub Sync: ${event.message}`);
			}),
		);
		this.register(
			this.syncManager.on("error", (event) => {
				this.statusBar.showError();
				new Notice(`GitHub Sync: ${event.message}`);
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

		this.scheduleAutoSync();
	}

	private scheduleAutoSync(): void {
		this.clearAutoSyncTimer();
		this.autoSyncTimeoutId = window.setTimeout(() => {
			this.autoSyncTimeoutId = null;
			if (!this.settings.autoSyncEnabled) {
				return;
			}

			void this.syncManager.fullSync("auto");
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

		if (result.errorCategory !== undefined) {
			return String(result.errorCategory);
		}

		return "Command failed without output.";
	}

	private isNodeError(error: unknown): error is NodeJS.ErrnoException {
		return error instanceof Error;
	}
}
