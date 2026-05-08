import { spawn } from "child_process";
import { GitHubSyncSettings } from "../settings";
import { GitBinaryDetectionResult } from "./GitTypes";

const FALLBACK_GIT_PATHS = [
	"/opt/homebrew/bin/git",
	"/usr/local/bin/git",
	"/usr/bin/git",
	"C:\\Program Files\\Git\\bin\\git.exe",
	"C:\\Program Files\\Git\\cmd\\git.exe",
	"git",
];

export class GitBinaryDetector {
	constructor(private readonly settings: GitHubSyncSettings) {}

	async detect(): Promise<GitBinaryDetectionResult> {
		const configuredPath = this.settings.gitBinaryPath.trim();
		const candidatePaths =
			configuredPath.length > 0
				? [configuredPath, ...FALLBACK_GIT_PATHS]
				: FALLBACK_GIT_PATHS;

		for (const candidatePath of candidatePaths) {
			if (await this.canRunGit(candidatePath)) {
				return { ok: true, path: candidatePath };
			}
		}

		return {
			ok: false,
			message: "Could not find a working git binary. Set the git path in settings.",
		};
	}

	private async canRunGit(binaryPath: string): Promise<boolean> {
		return new Promise((resolve) => {
			const child = spawn(binaryPath, ["--version"], { shell: false });
			const timeout = window.setTimeout(() => {
				child.kill("SIGTERM");
				resolve(false);
			}, 5000);

			child.once("error", () => {
				window.clearTimeout(timeout);
				resolve(false);
			});

			child.once("close", (code: number | null) => {
				window.clearTimeout(timeout);
				resolve(code === 0);
			});
		});
	}
}
