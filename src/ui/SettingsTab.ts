import { App, PluginSettingTab, Setting } from "obsidian";
import type GitHubSyncPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: GitHubSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "GitHub Sync" });

		this.addRepositorySection(containerEl);
		this.addAutoSyncSection(containerEl);
		this.addCommitsSection(containerEl);
		this.addIgnorePatternsSection(containerEl);
		this.addAdvancedSection(containerEl);
	}

	private addRepositorySection(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Repository" });

		new Setting(containerEl)
			.setName("Remote name")
			.setDesc("Git remote used for pull and push.")
			.addText((text) =>
				text
					.setPlaceholder("origin")
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
					.setPlaceholder("main")
					.setValue(this.plugin.settings.branchName)
					.onChange(async (value) => {
						this.plugin.settings.branchName = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	private addAutoSyncSection(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Auto Sync" });

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
		containerEl.createEl("h3", { text: "Commits" });

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

	private addIgnorePatternsSection(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Ignore Patterns" });

		new Setting(containerEl)
			.setName(".gitignore content")
			.setDesc("Rules to write to the vault root .gitignore file.")
			.addTextArea((text) => {
				text.inputEl.rows = 8;
				text.inputEl.cols = 40;
				text.setValue(this.plugin.settings.ignorePatterns).onChange(async (value) => {
					this.plugin.settings.ignorePatterns = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Write .gitignore")
			.setDesc("Create .gitignore if it is missing. Existing different content is not overwritten.")
			.addButton((button) =>
				button
					.setButtonText("Write .gitignore")
					.onClick(() => {
						void this.plugin.writeRootFile(".gitignore", this.plugin.settings.ignorePatterns);
					}),
			);
	}

	private addAdvancedSection(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Advanced" });

		new Setting(containerEl)
			.setName("Git binary path override")
			.setDesc("Leave empty to auto-detect git.")
			.addText((text) =>
				text
					.setPlaceholder("git")
					.setValue(this.plugin.settings.gitBinaryPath)
					.onChange(async (value) => {
						this.plugin.settings.gitBinaryPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Status bar")
			.setDesc("Show GitHub Sync state in the Obsidian status bar.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.statusBarEnabled).onChange(async (value) => {
					this.plugin.settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Check git, repository state, branch, remote access, and optional local author config.")
			.addButton((button) =>
				button
					.setButtonText("Test connection")
					.onClick(() => {
						void this.plugin.testConnection();
					}),
			);

		new Setting(containerEl)
			.setName("Write .gitattributes")
			.setDesc("Create .gitattributes if it is missing. Existing different content is not overwritten.")
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
