export enum GitErrorCategory {
	GIT_NOT_FOUND = "GIT_NOT_FOUND",
	NOT_A_REPO = "NOT_A_REPO",
	AUTH_FAILED = "AUTH_FAILED",
	NETWORK_FAILED = "NETWORK_FAILED",
	CONFLICT = "CONFLICT",
	REBASE_IN_PROGRESS = "REBASE_IN_PROGRESS",
	MERGE_IN_PROGRESS = "MERGE_IN_PROGRESS",
	INDEX_LOCKED = "INDEX_LOCKED",
	NO_CHANGES = "NO_CHANGES",
	PUSH_REJECTED = "PUSH_REJECTED",
	UNKNOWN = "UNKNOWN",
}

export interface GitCommandOptions {
	args: string[];
	commandLabel: string;
	timeoutMs?: number;
	env?: Record<string, string>;
}

export interface GitCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	commandLabel: string;
	errorCategory?: GitErrorCategory;
	timedOut?: boolean;
}

export interface GitBooleanResult extends GitCommandResult {
	value: boolean;
}

export interface GitStringArrayResult extends GitCommandResult {
	values: string[];
}

export interface GitRepositoryState {
	rebaseMerge: boolean;
	rebaseApply: boolean;
	mergeHead: boolean;
	indexLocked: boolean;
}

export interface GitBinaryDetectionSuccess {
	ok: true;
	path: string;
}

export interface GitBinaryDetectionFailure {
	ok: false;
	message: string;
}

export type GitBinaryDetectionResult = GitBinaryDetectionSuccess | GitBinaryDetectionFailure;
