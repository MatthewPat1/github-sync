import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { App } from "obsidian";
import { GitHubSyncSettings } from "../settings";
import { redactSecrets } from "../utils/redactSecrets";
import { GitBinaryDetector } from "./GitBinaryDetector";
import {
	GitBinaryDetectionResult,
	GitBooleanResult,
	GitCommandOptions,
	GitCommandResult,
	GitErrorCategory,
	GitRepositoryState,
	GitStringArrayResult,
} from "./GitTypes";

const DEFAULT_GIT_TIMEOUT_MS = 120000;

interface GitServiceOptions {
	app: App;
	settings: GitHubSyncSettings;
	gitBinaryDetector: GitBinaryDetector;
}

interface FileSystemAdapterLike {
	getBasePath(): string;
}

export class GitService {
	constructor(private readonly options: GitServiceOptions) {}

	async detectGitBinary(): Promise<GitBinaryDetectionResult> {
		return this.options.gitBinaryDetector.detect();
	}

	async getGitVersion(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["--version"],
			commandLabel: "git --version",
			timeoutMs: 10000,
		});
	}

	async isInsideWorkTree(): Promise<GitBooleanResult> {
		const result = await this.runGit({
			args: ["rev-parse", "--is-inside-work-tree"],
			commandLabel: "git rev-parse --is-inside-work-tree",
			timeoutMs: 10000,
		});

		return {
			...result,
			value: result.exitCode === 0 && result.stdout.trim() === "true",
		};
	}

	async getCurrentBranch(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["branch", "--show-current"],
			commandLabel: "git branch --show-current",
			timeoutMs: 10000,
		});
	}

	async getRemoteUrl(remote: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["remote", "get-url", remote],
			commandLabel: `git remote get-url ${redactSecrets(remote)}`,
			timeoutMs: 10000,
		});
	}

	async getStatusPorcelain(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["status", "--porcelain=v1"],
			commandLabel: "git status --porcelain=v1",
		});
	}

	async getUnmergedFiles(): Promise<GitStringArrayResult> {
		const result = await this.runGit({
			args: ["diff", "--name-only", "--diff-filter=U"],
			commandLabel: "git diff --name-only --diff-filter=U",
		});

		return {
			...result,
			values: this.parseLines(result.stdout),
		};
	}

	async hasChanges(): Promise<GitBooleanResult> {
		const result = await this.getStatusPorcelain();
		return {
			...result,
			value: result.exitCode === 0 && result.stdout.trim().length > 0,
		};
	}

	async hasStagedChanges(): Promise<GitBooleanResult> {
		const result = await this.runGit({
			args: ["diff", "--cached", "--quiet"],
			commandLabel: "git diff --cached --quiet",
		});

		return {
			...result,
			value: result.exitCode === 1,
		};
	}

	async fetch(remote: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["fetch", "--prune", remote],
			commandLabel: `git fetch --prune ${redactSecrets(remote)}`,
			timeoutMs: 300000,
		});
	}

	async pullRebaseAutostash(remote: string, branch: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["pull", "--rebase", "--autostash", remote, branch],
			commandLabel: `git pull --rebase --autostash ${redactSecrets(remote)} ${branch}`,
			timeoutMs: 300000,
		});
	}

	async stageAll(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["add", "--all"],
			commandLabel: "git add --all",
		});
	}

	async stagePaths(paths: string[]): Promise<GitCommandResult> {
		const uniquePaths = Array.from(new Set(paths.filter((filePath) => filePath.length > 0)));
		if (uniquePaths.length === 0) {
			return {
				exitCode: 0,
				stdout: "",
				stderr: "",
				commandLabel: "git add -- <paths>",
			};
		}

		return this.runGit({
			args: ["add", "--", ...uniquePaths],
			commandLabel: `git add -- <${uniquePaths.length} path(s)>`,
		});
	}

	async commit(message: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["commit", "-m", message],
			commandLabel: "git commit -m <message>",
		});
	}

	async push(remote: string, branch: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["push", remote, branch],
			commandLabel: `git push ${redactSecrets(remote)} ${branch}`,
			timeoutMs: 300000,
		});
	}

	async setLocalUserConfig(name: string, email: string): Promise<GitCommandResult> {
		const nameResult = await this.runGit({
			args: ["config", "--local", "user.name", name],
			commandLabel: "git config --local user.name <name>",
		});
		if (nameResult.exitCode !== 0) {
			return nameResult;
		}

		const emailResult = await this.runGit({
			args: ["config", "--local", "user.email", email],
			commandLabel: "git config --local user.email <email>",
		});

		return {
			...emailResult,
			stdout: [nameResult.stdout, emailResult.stdout].filter(Boolean).join("\n"),
			stderr: [nameResult.stderr, emailResult.stderr].filter(Boolean).join("\n"),
			commandLabel: "git config --local user.name <name>; git config --local user.email <email>",
		};
	}

	async getLocalUserName(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["config", "--local", "--get", "user.name"],
			commandLabel: "git config --local --get user.name",
			timeoutMs: 10000,
		});
	}

	async getLocalUserEmail(): Promise<GitCommandResult> {
		return this.runGit({
			args: ["config", "--local", "--get", "user.email"],
			commandLabel: "git config --local --get user.email",
			timeoutMs: 10000,
		});
	}

	async lsRemote(remote: string): Promise<GitCommandResult> {
		return this.runGit({
			args: ["ls-remote", remote],
			commandLabel: `git ls-remote ${redactSecrets(remote)}`,
			timeoutMs: 300000,
		});
	}

	async getRepositoryState(): Promise<GitRepositoryState> {
		const gitDirectory = await this.getGitDirectory();
		if (gitDirectory === null) {
			return {
				rebaseMerge: false,
				rebaseApply: false,
				mergeHead: false,
				indexLocked: false,
			};
		}

		return {
			rebaseMerge: await this.pathExists(path.join(gitDirectory, "rebase-merge")),
			rebaseApply: await this.pathExists(path.join(gitDirectory, "rebase-apply")),
			mergeHead: await this.pathExists(path.join(gitDirectory, "MERGE_HEAD")),
			indexLocked: await this.pathExists(path.join(gitDirectory, "index.lock")),
		};
	}

	getVaultRootPath(): string {
		return this.getVaultPath();
	}

	private async runGit(command: GitCommandOptions): Promise<GitCommandResult> {
		const detection = await this.detectGitBinary();
		if (!detection.ok) {
			return {
				exitCode: 127,
				stdout: "",
				stderr: detection.message,
				commandLabel: command.commandLabel,
				errorCategory: GitErrorCategory.GIT_NOT_FOUND,
			};
		}

		const repoStateCategory = await this.getBlockingRepositoryStateCategory(command.args);
		if (repoStateCategory !== null) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: this.getRepositoryStateMessage(repoStateCategory),
				commandLabel: command.commandLabel,
				errorCategory: repoStateCategory,
			};
		}

		const result = await this.spawnGit(detection.path, command);
		return {
			...result,
			errorCategory: this.categorizeResult(result),
		};
	}

	private async spawnGit(gitBinaryPath: string, command: GitCommandOptions): Promise<GitCommandResult> {
		return new Promise((resolve) => {
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let settled = false;
			let timedOut = false;
			const child = spawn(gitBinaryPath, command.args, {
				cwd: this.getVaultPath(),
				env: {
					...process.env,
					...command.env,
				},
				shell: false,
			});
			const timeout = window.setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
			}, command.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);

			const settle = (result: GitCommandResult): void => {
				if (settled) {
					return;
				}

				settled = true;
				window.clearTimeout(timeout);
				resolve({
					...result,
					stdout: redactSecrets(result.stdout),
					stderr: redactSecrets(result.stderr),
				});
			};

			child.stdout.on("data", (chunk: Buffer) => {
				stdout.push(chunk);
			});

			child.stderr.on("data", (chunk: Buffer) => {
				stderr.push(chunk);
			});

			child.once("error", (error: Error) => {
				settle({
					exitCode: 127,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: error.message,
					commandLabel: command.commandLabel,
					errorCategory: GitErrorCategory.GIT_NOT_FOUND,
				});
			});

			child.once("close", (code: number | null) => {
				const stderrText = Buffer.concat(stderr).toString("utf8");
				settle({
					exitCode: timedOut ? 124 : code ?? 1,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: timedOut
						? `${stderrText}\nGit command timed out after ${command.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS}ms.`
						: stderrText,
					commandLabel: command.commandLabel,
					timedOut,
				});
			});
		});
	}

	private async getBlockingRepositoryStateCategory(args: string[]): Promise<GitErrorCategory | null> {
		if (this.shouldSkipRepositoryStateCheck(args)) {
			return null;
		}

		const state = await this.getRepositoryState();
		if (state.indexLocked) {
			return GitErrorCategory.INDEX_LOCKED;
		}

		if (state.rebaseMerge || state.rebaseApply) {
			return GitErrorCategory.REBASE_IN_PROGRESS;
		}

		if (state.mergeHead) {
			return GitErrorCategory.MERGE_IN_PROGRESS;
		}

		return null;
	}

	private shouldSkipRepositoryStateCheck(args: string[]): boolean {
		const command = args[0] ?? "";
		return (
			command === "--version" ||
			command === "rev-parse" ||
			command === "ls-remote" ||
			command === "diff" ||
			command === "status"
		);
	}

	private async getGitDirectory(): Promise<string | null> {
		const detection = await this.detectGitBinary();
		if (!detection.ok) {
			return null;
		}

		const result = await this.spawnGit(detection.path, {
			args: ["rev-parse", "--git-dir"],
			commandLabel: "git rev-parse --git-dir",
			timeoutMs: 10000,
		});
		if (result.exitCode !== 0) {
			return null;
		}

		const gitDirectory = result.stdout.trim();
		if (gitDirectory.length === 0) {
			return null;
		}

		return path.isAbsolute(gitDirectory)
			? gitDirectory
			: path.resolve(this.getVaultPath(), gitDirectory);
	}

	private getVaultPath(): string {
		const adapter = this.options.app.vault.adapter;
		if (this.isFileSystemAdapter(adapter)) {
			return adapter.getBasePath();
		}

		throw new Error("GitHub Sync requires Obsidian desktop filesystem access.");
	}

	private isFileSystemAdapter(adapter: unknown): adapter is FileSystemAdapterLike {
		return (
			typeof adapter === "object" &&
			adapter !== null &&
			"getBasePath" in adapter &&
			typeof adapter.getBasePath === "function"
		);
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private parseLines(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private categorizeResult(result: GitCommandResult): GitErrorCategory | undefined {
		if (result.exitCode === 0) {
			return undefined;
		}

		const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
		if (result.exitCode === 127 || output.includes("not found")) {
			return GitErrorCategory.GIT_NOT_FOUND;
		}

		if (output.includes("not a git repository")) {
			return GitErrorCategory.NOT_A_REPO;
		}

		if (output.includes("authentication failed") || output.includes("permission denied")) {
			return GitErrorCategory.AUTH_FAILED;
		}

		if (
			output.includes("could not resolve host") ||
			output.includes("failed to connect") ||
			output.includes("network is unreachable")
		) {
			return GitErrorCategory.NETWORK_FAILED;
		}

		if (output.includes("conflict") || output.includes("unmerged files")) {
			return GitErrorCategory.CONFLICT;
		}

		if (output.includes("rebase-merge") || output.includes("rebase-apply")) {
			return GitErrorCategory.REBASE_IN_PROGRESS;
		}

		if (output.includes("merge_head")) {
			return GitErrorCategory.MERGE_IN_PROGRESS;
		}

		if (output.includes("index.lock")) {
			return GitErrorCategory.INDEX_LOCKED;
		}

		if (output.includes("nothing to commit") || output.includes("no changes added to commit")) {
			return GitErrorCategory.NO_CHANGES;
		}

		if (output.includes("rejected") || output.includes("non-fast-forward")) {
			return GitErrorCategory.PUSH_REJECTED;
		}

		return GitErrorCategory.UNKNOWN;
	}

	private getRepositoryStateMessage(category: GitErrorCategory): string {
		switch (category) {
			case GitErrorCategory.REBASE_IN_PROGRESS:
				return "A git rebase is already in progress. Resolve it manually before syncing.";
			case GitErrorCategory.MERGE_IN_PROGRESS:
				return "A git merge is already in progress. Resolve it manually before syncing.";
			case GitErrorCategory.INDEX_LOCKED:
				return "Git index.lock exists. Close other git processes or remove the stale lock manually.";
			default:
				return "The repository is not ready for git operations.";
		}
	}
}
