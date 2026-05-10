import { GitCommandResult, GitErrorCategory, GitRepositoryState } from "../git/GitTypes";
import { GitService } from "../git/GitService";
import { GitHubSyncSettings } from "../settings";
import { getDeviceName } from "../utils/deviceName";

export type SyncTrigger = "manual" | "auto" | "startup";
export type SyncEventName =
	| "idle"
	| "pulling"
	| "committing"
	| "pushing"
	| "synced"
	| "conflict"
	| "error";

interface SyncManagerOptions {
	settings: GitHubSyncSettings;
	gitService: GitService;
}

type SyncOperation =
	| {
			type: "pullOnly";
	  }
	| {
			type: "fullSync";
			trigger: SyncTrigger;
			changedPaths: string[];
	  };

export interface SyncEvent {
	state: SyncEventName;
	message: string;
	trigger?: SyncTrigger;
	category?: GitErrorCategory;
	result?: GitCommandResult;
	conflictedFiles?: string[];
}

export interface SyncResult {
	ok: boolean;
	message: string;
	state: SyncEventName | "queued";
	category?: GitErrorCategory;
	result?: GitCommandResult;
}

export type SyncEventCallback = (event: SyncEvent) => void;

export interface CommitTemplateVariables {
	date: string;
	time: string;
	timestamp: string;
	device: string;
}

const SUCCESS_RESULT: GitCommandResult = {
	exitCode: 0,
	stdout: "",
	stderr: "",
	commandLabel: "sync manager",
};

export class SyncManager {
	private isRunning = false;
	private pendingOperation: SyncOperation | null = null;
	private readonly listeners = new Map<SyncEventName, Set<SyncEventCallback>>();

	constructor(private readonly options: SyncManagerOptions) {}

	on(eventName: SyncEventName, callback: SyncEventCallback): () => void {
		const callbacks = this.listeners.get(eventName) ?? new Set<SyncEventCallback>();
		callbacks.add(callback);
		this.listeners.set(eventName, callbacks);

		return () => {
			callbacks.delete(callback);
		};
	}

	async pullOnly(): Promise<SyncResult> {
		return this.enqueueOrRun({ type: "pullOnly" });
	}

	async fullSync(trigger: SyncTrigger, changedPaths: string[] = []): Promise<SyncResult> {
		return this.enqueueOrRun({ type: "fullSync", trigger, changedPaths });
	}

	async syncNow(): Promise<SyncResult> {
		return this.fullSync("manual");
	}

	async startupPull(): Promise<SyncResult> {
		if (!this.options.settings.startupPullEnabled) {
			return {
				ok: true,
				message: "Startup pull is disabled.",
				state: "idle",
			};
		}

		return this.pullOnly();
	}

	private async enqueueOrRun(operation: SyncOperation): Promise<SyncResult> {
		if (this.isRunning) {
			this.pendingOperation = operation;
			return {
				ok: true,
				message: "A sync is already running. One pending sync has been queued.",
				state: "queued",
			};
		}

		return this.runOperationLoop(operation);
	}

	private async runOperationLoop(initialOperation: SyncOperation): Promise<SyncResult> {
		this.isRunning = true;
		let currentOperation: SyncOperation | null = initialOperation;
		let firstResult: SyncResult | null = null;

		try {
			while (currentOperation !== null) {
				this.pendingOperation = null;
				const result = await this.runOperation(currentOperation);
				firstResult = firstResult ?? result;
				currentOperation = this.pendingOperation;
			}
		} finally {
			this.isRunning = false;
		}

		return firstResult ?? {
			ok: true,
			message: "No sync operation was run.",
			state: "idle",
		};
	}

	private async runOperation(operation: SyncOperation): Promise<SyncResult> {
		if (operation.type === "pullOnly") {
			return this.runPullOnly();
		}

		return this.runFullSync(operation.trigger, operation.changedPaths);
	}

	private async runPullOnly(): Promise<SyncResult> {
		const validation = await this.validateRepoState();
		if (!validation.ok) {
			return validation;
		}

		this.emit({
			state: "pulling",
			message: "Pulling changes from remote.",
		});
		const pullResult = await this.options.gitService.pullRebaseAutostash(
			this.options.settings.remoteName,
			this.options.settings.branchName,
		);
		return this.handlePullOnlyResult(pullResult);
	}

	private async runFullSync(trigger: SyncTrigger, changedPaths: string[]): Promise<SyncResult> {
		const validation = await this.validateRepoState(trigger);
		if (!validation.ok) {
			return validation;
		}

		const configResult = await this.configureLocalUserIfNeeded();
		if (configResult !== null && configResult.exitCode !== 0) {
			return this.errorResult("Failed to configure local git user.", configResult);
		}

		this.emit({
			state: "pulling",
			message: "Pulling changes from remote.",
			trigger,
		});
		const pullResult = await this.options.gitService.pullRebaseAutostash(
			this.options.settings.remoteName,
			this.options.settings.branchName,
		);
		const pullCheck = await this.validatePullResult(pullResult, trigger);
		if (!pullCheck.ok) {
			return pullCheck;
		}

		const changes = await this.options.gitService.hasChanges();
		if (changes.exitCode !== 0) {
			return this.errorResult("Failed to check repository changes.", changes, trigger);
		}

		if (!changes.value) {
			return this.syncedResult("No local changes to commit after pull.", trigger);
		}

		this.emit({
			state: "committing",
			message: "Committing local changes.",
			trigger,
		});
		if (trigger === "auto") {
			const stagedChanges = await this.options.gitService.hasStagedChanges();
			if (stagedChanges.exitCode > 1) {
				return this.errorResult("Failed to check staged changes.", stagedChanges, trigger);
			}

			if (stagedChanges.value) {
				return this.errorResult("Auto-sync found pre-staged changes. Run manual sync to review and commit them.", {
					...stagedChanges,
					exitCode: 1,
				}, trigger);
			}
		}

		const stageResult = trigger === "auto"
			? await this.options.gitService.stagePaths(changedPaths)
			: await this.options.gitService.stageAll();
		if (stageResult.exitCode !== 0) {
			return this.errorResult("Failed to stage local changes.", stageResult, trigger);
		}

		const commitMessage = renderCommitMessage(this.options.settings.commitMessageTemplate);
		const commitResult = await this.options.gitService.commit(commitMessage);
		if (commitResult.exitCode !== 0) {
			if (commitResult.errorCategory === GitErrorCategory.NO_CHANGES) {
				return this.syncedResult("No local changes to commit after staging.", trigger);
			}

			return this.errorResult("Failed to commit local changes.", commitResult, trigger);
		}

		this.emit({
			state: "pushing",
			message: "Pushing committed changes.",
			trigger,
		});
		const pushResult = await this.options.gitService.push(
			this.options.settings.remoteName,
			this.options.settings.branchName,
		);
		if (pushResult.exitCode !== 0) {
			return this.errorResult("Failed to push committed changes.", pushResult, trigger);
		}

		return this.syncedResult("Vault synced successfully.", trigger, pushResult);
	}

	private async validateRepoState(trigger?: SyncTrigger): Promise<SyncResult> {
		const workTree = await this.options.gitService.isInsideWorkTree();
		if (workTree.exitCode !== 0 || !workTree.value) {
			return this.errorResult(
				"The vault is not inside a git work tree.",
				{
					...workTree,
					errorCategory: workTree.errorCategory ?? GitErrorCategory.NOT_A_REPO,
				},
				trigger,
			);
		}

		const state = await this.options.gitService.getRepositoryState();
		const category = getBadRepositoryStateCategory(state);
		if (category !== null) {
			return this.errorResult(getBadRepositoryStateMessage(category), {
				...SUCCESS_RESULT,
				exitCode: 1,
				stderr: getBadRepositoryStateMessage(category),
				errorCategory: category,
			}, trigger);
		}

		return {
			ok: true,
			message: "Repository state is valid.",
			state: "idle",
		};
	}

	private async configureLocalUserIfNeeded(): Promise<GitCommandResult | null> {
		const name = this.options.settings.gitUserName.trim();
		const email = this.options.settings.gitUserEmail.trim();
		if (name.length === 0 || email.length === 0) {
			return null;
		}

		return this.options.gitService.setLocalUserConfig(name, email);
	}

	private async handlePullOnlyResult(result: GitCommandResult): Promise<SyncResult> {
		const validation = await this.validatePullResult(result);
		if (!validation.ok) {
			return validation;
		}

		return this.syncedResult("Pull completed.", undefined, result);
	}

	private async validatePullResult(result: GitCommandResult, trigger?: SyncTrigger): Promise<SyncResult> {
		if (result.exitCode === 0) {
			return {
				ok: true,
				message: "Pull completed.",
				state: "pulling",
				result,
			};
		}

		const unmergedFiles = await this.options.gitService.getUnmergedFiles();
		if (result.errorCategory === GitErrorCategory.CONFLICT || unmergedFiles.values.length > 0) {
			return this.conflictResult(
				"Git conflict detected. Resolve conflicts manually before syncing again.",
				result,
				unmergedFiles.values,
				trigger,
			);
		}

		return this.errorResult("Pull failed.", result, trigger);
	}

	private syncedResult(message: string, trigger?: SyncTrigger, result?: GitCommandResult): SyncResult {
		this.emit({
			state: "synced",
			message,
			trigger,
			result,
		});

		return {
			ok: true,
			message,
			state: "synced",
			result,
		};
	}

	private conflictResult(
		message: string,
		result: GitCommandResult,
		conflictedFiles: string[],
		trigger?: SyncTrigger,
	): SyncResult {
		this.emit({
			state: "conflict",
			message,
			trigger,
			category: GitErrorCategory.CONFLICT,
			result,
			conflictedFiles,
		});

		return {
			ok: false,
			message,
			state: "conflict",
			category: GitErrorCategory.CONFLICT,
			result,
		};
	}

	private errorResult(message: string, result: GitCommandResult, trigger?: SyncTrigger): SyncResult {
		const category = result.errorCategory ?? GitErrorCategory.UNKNOWN;
		this.emit({
			state: "error",
			message,
			trigger,
			category,
			result,
		});

		return {
			ok: false,
			message,
			state: "error",
			category,
			result,
		};
	}

	private emit(event: SyncEvent): void {
		const callbacks = this.listeners.get(event.state);
		if (callbacks === undefined) {
			return;
		}

		for (const callback of callbacks) {
			callback(event);
		}
	}
}

export function renderCommitMessage(template: string, date: Date = new Date(), device = getDeviceName()): string {
	return applyCommitTemplate(template, {
		date: formatDate(date),
		time: formatTime(date),
		timestamp: date.toISOString(),
		device,
	});
}

export function applyCommitTemplate(template: string, variables: CommitTemplateVariables): string {
	return template
		.split("{{date}}")
		.join(variables.date)
		.split("{{time}}")
		.join(variables.time)
		.split("{{timestamp}}")
		.join(variables.timestamp)
		.split("{{device}}")
		.join(variables.device);
}

export function getBadRepositoryStateCategory(state: GitRepositoryState): GitErrorCategory | null {
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

export function getBadRepositoryStateMessage(category: GitErrorCategory): string {
	switch (category) {
		case GitErrorCategory.REBASE_IN_PROGRESS:
			return "A git rebase is in progress. Resolve it manually before syncing.";
		case GitErrorCategory.MERGE_IN_PROGRESS:
			return "A git merge is in progress. Resolve it manually before syncing.";
		case GitErrorCategory.INDEX_LOCKED:
			return "Git index.lock exists. Close other git processes or remove the stale lock manually.";
		default:
			return "Repository state prevents syncing.";
	}
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
	return date.toTimeString().slice(0, 8);
}
