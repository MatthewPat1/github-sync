export interface GitHubSyncSettings {
	remoteName: string;
	branchName: string;
	autoSyncEnabled: boolean;
	idleTimeoutSeconds: number;
	startupPullEnabled: boolean;
	startupPullDelaySeconds: number;
	statusBarEnabled: boolean;
	gitBinaryPath: string;
	commitMessageTemplate: string;
	gitUserName: string;
	gitUserEmail: string;
	ignorePatterns: string;
	gitattributes: string;
}

export const DEFAULT_IGNORE_PATTERNS = [
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
	".trash/",
	".obsidian/workspace.json",
	".obsidian/workspace-mobile.json",
	".obsidian/cache/",
].join("\n");

export const DEFAULT_GITATTRIBUTES = [
	"* text=auto eol=lf",
	"*.md text eol=lf",
	"*.canvas text eol=lf",
	"*.json text eol=lf",
	"*.css text eol=lf",
	"*.png binary",
	"*.jpg binary",
	"*.jpeg binary",
	"*.gif binary",
	"*.webp binary",
	"*.pdf binary",
	"*.zip binary",
].join("\n");

export const DEFAULT_SETTINGS: GitHubSyncSettings = {
	remoteName: "origin",
	branchName: "main",
	autoSyncEnabled: true,
	idleTimeoutSeconds: 10,
	startupPullEnabled: true,
	startupPullDelaySeconds: 5,
	statusBarEnabled: true,
	gitBinaryPath: "",
	commitMessageTemplate: "vault sync: {{timestamp}} [{{device}}]",
	gitUserName: "",
	gitUserEmail: "",
	ignorePatterns: DEFAULT_IGNORE_PATTERNS,
	gitattributes: DEFAULT_GITATTRIBUTES,
};
