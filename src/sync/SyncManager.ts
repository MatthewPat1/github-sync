import { GitService } from "../git/GitService";
import { GitHubSyncSettings } from "../settings";

interface SyncManagerOptions {
	settings: GitHubSyncSettings;
	gitService: GitService;
}

export interface SyncResult {
	ok: boolean;
	message: string;
}

export class SyncManager {
	private isRunning = false;

	constructor(private readonly options: SyncManagerOptions) {}

	async syncNow(): Promise<SyncResult> {
		if (this.isRunning) {
			return {
				ok: false,
				message: "A sync is already running.",
			};
		}

		this.isRunning = true;
		try {
			const status = await this.options.gitService.statusShort();
			if (!status.ok) {
				return {
					ok: false,
					message: status.message,
				};
			}

			return {
				ok: true,
				message: "Sync skeleton completed.",
			};
		} finally {
			this.isRunning = false;
		}
	}

	async startupPull(): Promise<SyncResult> {
		if (!this.options.settings.startupPullEnabled) {
			return {
				ok: true,
				message: "Startup pull is disabled.",
			};
		}

		return this.syncNow();
	}
}
