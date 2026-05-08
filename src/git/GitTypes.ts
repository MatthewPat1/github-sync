export type GitErrorCategory =
	| "git-not-found"
	| "not-a-repository"
	| "conflict"
	| "authentication"
	| "network"
	| "unknown";

export interface GitCommandOptions {
	args: string[];
	cwd: string;
	env?: Record<string, string>;
}

export interface GitCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface GitFailure {
	ok: false;
	category: GitErrorCategory;
	message: string;
	details?: string;
}

export interface GitSuccess<T> {
	ok: true;
	value: T;
}

export type GitResult<T> = GitSuccess<T> | GitFailure;

export interface GitBinaryDetectionSuccess {
	ok: true;
	path: string;
}

export interface GitBinaryDetectionFailure {
	ok: false;
	message: string;
}

export type GitBinaryDetectionResult = GitBinaryDetectionSuccess | GitBinaryDetectionFailure;
