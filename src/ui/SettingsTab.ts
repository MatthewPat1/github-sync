import { App, PluginSettingTab, Setting } from "obsidian";
import type GitHubSyncPlugin from "../main";
import type { SetupChecklistItem } from "../main";
import {
	createDefaultIgnorePatterns,
	createDefaultWatchPluginReleaseFilesForAutoSync,
	PluginTrackingMode,
} from "../settings";

export class SettingsTab extends PluginSettingTab {
	private setupResults: SetupChecklistItem[] | null = null;
	private setupTestRunning = false;

	constructor(app: App, private readonly plugin: GitHubSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addSetupChecklistSection(containerEl);
		this.addRepositorySection(containerEl);
		this.addAutoSyncSection(containerEl);
		this.addPluginTrackingSection(containerEl);
		this.addCommitsSection(containerEl);
		this.addIgnorePatternsSection(containerEl);
		this.addAdvancedSection(containerEl);
	}

	private addSetupChecklistSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Setup checklist").setHeading();
		containerEl.createEl("p", {
			text: "Use this checklist to confirm the vault is ready to sync. The plugin will not run Git init or add remotes automatically.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Setup actions")
			.setDesc(this.setupTestRunning ? "Testing setup..." : "Run setup checks or copy terminal commands for manual setup.")
			.addButton((button) =>
				button
					.setButtonText(this.setupTestRunning ? "Testing..." : "Test setup")
					.setDisabled(this.setupTestRunning)
					.onClick(() => {
						void this.testSetup();
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Write .gitignore")
					.onClick(() => {
						void this.plugin.writeGitignore();
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Write .gitattributes")
					.onClick(() => {
						void this.plugin.writeRootFile(".gitattributes", this.plugin.settings.gitattributes);
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Copy terminal setup commands")
					.onClick(() => {
						void this.plugin.copyTerminalSetupCommands();
					}),
			);

		if (this.setupResults === null) {
			new Setting(containerEl)
				.setName("Setup status")
				.setDesc("Click test setup to check Git, repository, remote, branch, author, and setup files.");
			return;
		}

		for (const result of this.setupResults) {
			new Setting(containerEl)
				.setName(`${result.passed ? "Pass" : "Fail"}: ${result.label}`)
				.setDesc(result.detail);
		}
	}

	private async testSetup(): Promise<void> {
		this.setupTestRunning = true;
		this.display();
		try {
			this.setupResults = await this.plugin.testSetupChecklist();
		} finally {
			this.setupTestRunning = false;
			this.display();
		}
	}

	private addRepositorySection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Repository").setHeading();

		new Setting(containerEl)
			.setName("Remote name")
			.setDesc("Git remote used for pull and push.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.remoteName)
					.onChange(async (value) => {
						this.plugin.settings.remoteName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Branch name")
			.setDesc("Git branch used for pull and push.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.branchName)
					.onChange(async (value) => {
						this.plugin.settings.branchName = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	private addAutoSyncSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Auto sync").setHeading();

		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc("Sync after vault changes settle.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Idle timeout")
			.setDesc("Seconds to wait after the last file change before auto-sync.")
			.addSlider((slider) =>
				slider
					.setLimits(5, 120, 1)
					.setValue(clampInteger(this.plugin.settings.idleTimeoutSeconds, 5, 120))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.idleTimeoutSeconds = clampInteger(value, 5, 120);
						await this.plugin.saveSettings();
						this.display();
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(String(clampInteger(this.plugin.settings.idleTimeoutSeconds, 5, 120)))
					.onChange(async (value) => {
						this.plugin.settings.idleTimeoutSeconds = clampInteger(parseInteger(value, 10), 5, 120);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Startup pull")
			.setDesc("Pull after Obsidian starts.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.startupPullEnabled).onChange(async (value) => {
					this.plugin.settings.startupPullEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Startup pull delay")
			.setDesc("Seconds to wait before startup pull.")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.plugin.settings.startupPullDelaySeconds))
					.onChange(async (value) => {
						this.plugin.settings.startupPullDelaySeconds = parseInteger(value, 5);
						await this.plugin.saveSettings();
					}),
			);
	}

	private addCommitsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Commits").setHeading();

		new Setting(containerEl)
			.setName("Commit message template")
			.setDesc("Supports {{date}}, {{time}}, {{timestamp}}, and {{device}}.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.commitMessageTemplate)
					.onChange(async (value) => {
						this.plugin.settings.commitMessageTemplate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Git user name")
			.setDesc("Optional local commit author name.")
			.addText((text) =>
				text.setValue(this.plugin.settings.gitUserName).onChange(async (value) => {
					this.plugin.settings.gitUserName = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Git user email")
			.setDesc("Optional local commit author email.")
			.addText((text) =>
				text.setValue(this.plugin.settings.gitUserEmail).onChange(async (value) => {
					this.plugin.settings.gitUserEmail = value.trim();
					await this.plugin.saveSettings();
				}),
			);
	}

	private addPluginTrackingSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Plugin tracking").setHeading();
		containerEl.createEl("p", {
			text: "Ignoring plugins is safest; tracking release files lets Git sync installed plugin code, but plugin updates may create commits, and brat plus GitHub sync should usually remain managed outside the vault repo.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Plugin tracking mode")
			.setDesc("Choose how generated .gitignore rules treat Obsidian community plugins.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("ignore-all", "Ignore all plugins")
					.addOption("release-files-only", "Track release files only")
					.addOption("custom", "Custom")
					.setValue(this.plugin.settings.pluginTrackingMode)
					.onChange(async (value) => {
						const mode = value as PluginTrackingMode;
						this.plugin.settings.pluginTrackingMode = mode;
						this.plugin.settings.watchPluginReleaseFilesForAutoSync = createDefaultWatchPluginReleaseFilesForAutoSync(mode);
						if (mode !== "custom") {
							this.plugin.settings.ignorePatterns = createDefaultIgnorePatterns(this.app.vault.configDir, mode);
						}
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Watch plugin release files")
			.setDesc("Trigger auto-sync when manifest.json, main.js, or styles.css changes in tracked plugin folders.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.watchPluginReleaseFilesForAutoSync).onChange(async (value) => {
					this.plugin.settings.watchPluginReleaseFilesForAutoSync = value;
					await this.plugin.saveSettings();
				}),
			);

		if (this.plugin.settings.pluginTrackingMode === "release-files-only") {
			new Setting(containerEl)
				.setName("Plugin update warning")
				.setDesc("Plugin updates may create Git commits; GitHub sync, brat, plugin data.json files, source trees, build outputs, and dependency folders remain ignored by the generated rules.");
		}
	}

	private addIgnorePatternsSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Ignore patterns").setHeading();

		new Setting(containerEl)
			.setName(".gitignore content")
			.setDesc("Rules to write to the vault root .gitignore file.")
			.addTextArea((text) => {
				text.inputEl.rows = 8;
				text.inputEl.cols = 40;
				text.setValue(this.plugin.settings.ignorePatterns).onChange(async (value) => {
					this.plugin.settings.ignorePatterns = value;
					this.plugin.settings.pluginTrackingMode = "custom";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Write .gitignore")
			.setDesc("Write .gitignore to the vault root. Existing different content requires confirmation.")
			.addButton((button) =>
				button
					.setButtonText("Write .gitignore")
					.onClick(() => {
						void this.plugin.writeGitignore();
					}),
			);
	}

	private addAdvancedSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Git binary path override")
			.setDesc("Leave empty to auto-detect Git.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.gitBinaryPath)
					.onChange(async (value) => {
						this.plugin.settings.gitBinaryPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Status bar")
			.setDesc("Show GitHub sync state in the Obsidian status bar.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.statusBarEnabled).onChange(async (value) => {
					this.plugin.settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Check Git, repository state, branch, remote access, and optional local author config.")
			.addButton((button) =>
				button
					.setButtonText("Test connection")
					.onClick(() => {
						void this.plugin.testConnection();
					}),
			);

		new Setting(containerEl)
			.setName("Write .gitattributes")
			.setDesc("Write .gitattributes to the vault root. May cause a one-time normalization diff.")
			.addButton((button) =>
				button
					.setButtonText("Write .gitattributes")
					.onClick(() => {
						void this.plugin.writeRootFile(".gitattributes", this.plugin.settings.gitattributes);
					}),
			);
	}
}

function parseInteger(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}
