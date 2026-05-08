import { spawn } from "child_process";
import { GitHubSyncSettings } from "../settings";
import { GitBinaryDetectionResult } from "./GitTypes";

export class GitBinaryDetector {
	constructor(private readonly settings: GitHubSyncSettings) {}

	async detect(): Promise<GitBinaryDetectionResult> {
		if (this.settings.gitBinaryPath.trim().length > 0) {
			const configuredPath = this.settings.gitBinaryPath.trim();
			if (await this.canRunGit(configuredPath)) {
				return { ok: true, path: configuredPath };
			}
		}

		if (await this.canRunGit("git")) {
			return { ok: true, path: "git" };
		}

		return {
			ok: false,
			message: "Could not find a working git binary. Set the git path in settings.",
		};
	}

	private async canRunGit(binaryPath: string): Promise<boolean> {
		return new Promise((resolve) => {
			const child = spawn(binaryPath, ["--version"], { shell: false });

			child.once("error", () => {
				resolve(false);
			});

			child.once("close", (code: number | null) => {
				resolve(code === 0);
			});
		});
	}
}
