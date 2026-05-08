import { Plugin } from "obsidian";
import { GitHubSyncSettings } from "../settings";

export class StatusBarController {
	private statusBarItemEl: HTMLElement | null = null;
	private settings: GitHubSyncSettings;

	constructor(private readonly plugin: Plugin, settings: GitHubSyncSettings) {
		this.settings = settings;
		if (settings.statusBarEnabled) {
			this.statusBarItemEl = plugin.addStatusBarItem();
		}
	}

	refresh(settings: GitHubSyncSettings): void {
		this.settings = settings;
		if (!this.settings.statusBarEnabled) {
			this.statusBarItemEl?.remove();
			this.statusBarItemEl = null;
			return;
		}

		if (this.statusBarItemEl === null) {
			this.statusBarItemEl = this.plugin.addStatusBarItem();
		}
		this.showIdle();
	}

	showIdle(): void {
		this.setText("GitHub Sync: idle");
	}

	showWorking(label: string): void {
		this.setText(`GitHub Sync: ${label}`);
	}

	showError(): void {
		this.setText("GitHub Sync: error");
	}

	unload(): void {
		this.statusBarItemEl?.remove();
		this.statusBarItemEl = null;
	}

	private setText(text: string): void {
		if (!this.settings.statusBarEnabled) {
			return;
		}

		this.statusBarItemEl?.setText(text);
	}
}
