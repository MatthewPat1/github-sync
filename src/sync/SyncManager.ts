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
			const status = await this.options.gitService.getStatusPorcelain();
			if (status.exitCode !== 0) {
				return {
					ok: false,
					message: status.stderr || "The vault is not ready for git status checks.",
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
