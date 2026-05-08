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

		new Setting(containerEl)
			.setName("Remote")
			.setDesc("Git remote used for sync operations.")
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
			.setName("Branch")
			.setDesc("Git branch used for sync operations.")
			.addText((text) =>
				text
					.setPlaceholder("main")
					.setValue(this.plugin.settings.branchName)
					.onChange(async (value) => {
						this.plugin.settings.branchName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Git binary path")
			.setDesc("Leave empty to use git from PATH.")
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
			.setName("Auto sync")
			.setDesc("Queue sync work after vault changes.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Idle timeout")
			.setDesc("Seconds to wait after changes before auto sync.")
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(String(this.plugin.settings.idleTimeoutSeconds))
					.onChange(async (value) => {
						this.plugin.settings.idleTimeoutSeconds = this.parsePositiveInteger(value, 10);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Startup pull")
			.setDesc("Run a delayed pull placeholder when Obsidian starts.")
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
						this.plugin.settings.startupPullDelaySeconds = this.parsePositiveInteger(value, 5);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Status bar")
			.setDesc("Show GitHub Sync state in the status bar.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.statusBarEnabled).onChange(async (value) => {
					this.plugin.settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Commit message template")
			.setDesc("Supports {{timestamp}} and {{device}} placeholders.")
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
			.setDesc("Optional per-repository commit author name.")
			.addText((text) =>
				text.setValue(this.plugin.settings.gitUserName).onChange(async (value) => {
					this.plugin.settings.gitUserName = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Git user email")
			.setDesc("Optional per-repository commit author email.")
			.addText((text) =>
				text.setValue(this.plugin.settings.gitUserEmail).onChange(async (value) => {
					this.plugin.settings.gitUserEmail = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(".gitignore patterns")
			.setDesc("Default Obsidian-specific ignore rules.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.ignorePatterns).onChange(async (value) => {
					this.plugin.settings.ignorePatterns = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(".gitattributes")
			.setDesc("Line ending normalization and binary file rules.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.gitattributes).onChange(async (value) => {
					this.plugin.settings.gitattributes = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	private parsePositiveInteger(value: string, fallback: number): number {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed) || parsed < 0) {
			return fallback;
		}

		return parsed;
	}
}
