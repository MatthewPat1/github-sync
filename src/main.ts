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

		this.statusBar.showIdle();

		this.addRibbonIcon("git-branch", "GitHub Sync: Sync now", () => {
			void this.runManualSync();
		});

		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: () => {
				void this.runManualSync();
			},
		});

		this.addCommand({
			id: "detect-git-binary",
			name: "Detect git binary",
			callback: () => {
				void this.detectGitBinary();
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

	private async runManualSync(): Promise<void> {
		this.statusBar.showWorking("Syncing");
		const result = await this.syncManager.syncNow();
		if (result.ok) {
			this.statusBar.showIdle();
			new Notice("GitHub Sync: sync placeholder completed.");
			return;
		}

		this.statusBar.showError();
		new Notice(`GitHub Sync: ${result.message}`);
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
}
