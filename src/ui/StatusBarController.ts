import { Plugin } from "obsidian";
import { GitHubSyncSettings } from "../settings";

export class StatusBarController {
	private statusBarItemEl: HTMLElement | null = null;
	private settings: GitHubSyncSettings;
	private lastSyncedAt: Date | null = null;
	private syncedIntervalId: number | null = null;

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
		this.lastSyncedAt = null;
		this.setText("☁ GitHub Sync");
	}

	showPulling(): void {
		this.lastSyncedAt = null;
		this.setText("↓ Pulling…");
	}

	showCommitting(): void {
		this.lastSyncedAt = null;
		this.setText("● Committing…");
	}

	showPushing(): void {
		this.lastSyncedAt = null;
		this.setText("↑ Pushing…");
	}

	showSynced(date: Date = new Date()): void {
		this.lastSyncedAt = date;
		this.updateSyncedText();
		this.ensureSyncedInterval();
	}

	showConflict(): void {
		this.lastSyncedAt = null;
		this.setText("⚠ Conflict!");
	}

	showError(): void {
		this.lastSyncedAt = null;
		this.setText("✗ Sync error");
	}

	showWorking(label: string): void {
		this.lastSyncedAt = null;
		this.setText(`GitHub Sync: ${label}`);
	}

	unload(): void {
		if (this.syncedIntervalId !== null) {
			window.clearInterval(this.syncedIntervalId);
			this.syncedIntervalId = null;
		}
		this.statusBarItemEl?.remove();
		this.statusBarItemEl = null;
	}

	private setText(text: string): void {
		if (!this.settings.statusBarEnabled) {
			return;
		}

		this.statusBarItemEl?.setText(text);
	}

	private ensureSyncedInterval(): void {
		if (this.syncedIntervalId !== null) {
			return;
		}

		this.syncedIntervalId = window.setInterval(() => {
			this.updateSyncedText();
		}, 60 * 1000);
		this.plugin.register(() => {
			if (this.syncedIntervalId !== null) {
				window.clearInterval(this.syncedIntervalId);
				this.syncedIntervalId = null;
			}
		});
	}

	private updateSyncedText(): void {
		if (this.lastSyncedAt === null) {
			return;
		}

		const elapsedMinutes = Math.max(
			0,
			Math.floor((Date.now() - this.lastSyncedAt.getTime()) / (60 * 1000)),
		);
		const unit = elapsedMinutes === 1 ? "minute" : "minutes";
		this.setText(`✓ Synced ${elapsedMinutes} ${unit} ago`);
	}
}
