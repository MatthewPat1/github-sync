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
		this.setText("☁ GitHub sync");
	}

	showPulling(): void {
		this.lastSyncedAt = null;
		this.setText("↓ pulling…");
	}

	showCommitting(): void {
		this.lastSyncedAt = null;
		this.setText("● committing…");
	}

	showPushing(): void {
		this.lastSyncedAt = null;
		this.setText("↑ pushing…");
	}

	showSynced(date: Date = new Date()): void {
		this.lastSyncedAt = date;
		this.updateSyncedText();
		this.ensureSyncedInterval();
	}

	showConflict(): void {
		this.lastSyncedAt = null;
		this.setText("⚠ conflict!");
	}

	showError(): void {
		this.lastSyncedAt = null;
		this.setText("✗ sync error");
	}

	showWorking(label: string): void {
		this.lastSyncedAt = null;
		this.setText(`GitHub sync: ${label}`);
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

		this.setText(`✓ synced ${formatSyncedAt(this.lastSyncedAt, new Date())}`);
	}
}

export function formatSyncedAt(syncedAt: Date, now: Date): string {
	const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - syncedAt.getTime()) / (60 * 1000)));
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes} ${pluralize("minute", elapsedMinutes)} ago`;
	}

	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `${elapsedHours} ${pluralize("hour", elapsedHours)} ago`;
	}

	const elapsedDays = Math.floor(elapsedHours / 24);
	if (elapsedDays < 2) {
		const remainingHours = elapsedHours % 24;
		if (remainingHours === 0) {
			return `${elapsedDays} ${pluralize("day", elapsedDays)} ago`;
		}

		return `${elapsedDays} ${pluralize("day", elapsedDays)} ${remainingHours} ${pluralize("hour", remainingHours)} ago`;
	}

	return `on ${syncedAt.toLocaleString()}`;
}

function pluralize(unit: string, value: number): string {
	return value === 1 ? unit : `${unit}s`;
}
