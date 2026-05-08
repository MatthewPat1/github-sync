import { App, normalizePath } from "obsidian";
import { spawn } from "child_process";
import { GitHubSyncSettings } from "../settings";
import { redactSecrets } from "../utils/redactSecrets";
import { GitBinaryDetector } from "./GitBinaryDetector";
import {
	GitBinaryDetectionResult,
	GitCommandOptions,
	GitCommandResult,
	GitResult,
} from "./GitTypes";

interface GitServiceOptions {
	app: App;
	settings: GitHubSyncSettings;
	gitBinaryDetector: GitBinaryDetector;
}

export class GitService {
	constructor(private readonly options: GitServiceOptions) {}

	async detectGitBinary(): Promise<GitBinaryDetectionResult> {
		return this.options.gitBinaryDetector.detect();
	}

	async version(): Promise<GitResult<string>> {
		const result = await this.run({
			args: ["--version"],
			cwd: this.getVaultPath(),
		});

		if (result.exitCode !== 0) {
			return {
				ok: false,
				category: "git-not-found",
				message: "Git is not available.",
				details: redactSecrets(result.stderr),
			};
		}

		return { ok: true, value: result.stdout.trim() };
	}

	async statusShort(): Promise<GitResult<string>> {
		const result = await this.run({
			args: ["status", "--short"],
			cwd: this.getVaultPath(),
		});

		if (result.exitCode !== 0) {
			return {
				ok: false,
				category: "not-a-repository",
				message: "The vault is not ready for git status checks.",
				details: redactSecrets(result.stderr),
			};
		}

		return { ok: true, value: result.stdout };
	}

	private async run(command: GitCommandOptions): Promise<GitCommandResult> {
		const detection = await this.detectGitBinary();
		if (!detection.ok) {
			return {
				exitCode: 127,
				stdout: "",
				stderr: detection.message,
			};
		}

		return new Promise((resolve) => {
			const child = spawn(detection.path, command.args, {
				cwd: command.cwd,
				env: {
					...process.env,
					...command.env,
				},
				shell: false,
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];

			child.stdout.on("data", (chunk: Buffer) => {
				stdout.push(chunk);
			});

			child.stderr.on("data", (chunk: Buffer) => {
				stderr.push(chunk);
			});

			child.once("error", (error: Error) => {
				resolve({
					exitCode: 127,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: error.message,
				});
			});

			child.once("close", (code: number | null) => {
				resolve({
					exitCode: code ?? 1,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
				});
			});
		});
	}

	private getVaultPath(): string {
		const adapter = this.options.app.vault.adapter;
		if ("getBasePath" in adapter && typeof adapter.getBasePath === "function") {
			return normalizePath(adapter.getBasePath());
		}

		throw new Error("GitHub Sync requires Obsidian desktop filesystem access.");
	}
}
