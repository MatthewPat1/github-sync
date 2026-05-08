import { promises as fs } from "fs";
import path from "path";
import { Notice, Plugin } from "obsidian";
import { GitBinaryDetector } from "./git/GitBinaryDetector";
import { GitService } from "./git/GitService";
import { DEFAULT_SETTINGS, GitHubSyncSettings } from "./settings";
import { SyncManager } from "./sync/SyncManager";
import { SettingsTab } from "./ui/SettingsTab";
import { StatusBarController } from "./ui/StatusBarController";

export default class GitHubSyncPlugin extends Plugin {
	settings: GitHubSyncSettings;
	gitService: GitService;
	syncManager: SyncManager;
	statusBar: StatusBarController;

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

		if (this.settings.startupPullEnabled) {
			const startupPullTimeout = window.setTimeout(() => {
				void this.syncManager.startupPull();
			}, this.settings.startupPullDelaySeconds * 1000);
			this.register(() => window.clearTimeout(startupPullTimeout));
		}
	}

	onunload(): void {
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

	private async testConnection(): Promise<void> {
		const result = await this.gitService.lsRemote(this.settings.remoteName);
		if (result.exitCode === 0) {
			new Notice("GitHub Sync: connection test succeeded.");
			return;
		}

		new Notice(`GitHub Sync: connection test failed. ${result.stderr || result.stdout}`);
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

	private async writeRootFile(fileName: ".gitignore" | ".gitattributes", content: string): Promise<void> {
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
				new Notice(`GitHub Sync: ${event.message}`);
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

	private isNodeError(error: unknown): error is NodeJS.ErrnoException {
		return error instanceof Error;
	}
}
