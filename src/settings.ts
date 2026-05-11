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

export function createDefaultIgnorePatterns(configDir: string): string {
	return [
		".DS_Store",
		"Thumbs.db",
		"desktop.ini",
		".trash/",
		"",
		...createRequiredIgnorePatterns(configDir),
	].join("\n");
}

export function ensureRequiredIgnorePatterns(ignorePatterns: string, configDir: string): string {
	const requiredPatterns = createRequiredIgnorePatterns(configDir);
	const existingLines = new Set(ignorePatterns.split(/\r?\n/).map((line) => line.trim()));
	const missingPatterns = requiredPatterns.filter((line) => line.length > 0 && !line.startsWith("#") && !existingLines.has(line));
	if (missingPatterns.length === 0) {
		return ignorePatterns;
	}

	const separator = ignorePatterns.trim().length > 0 ? "\n\n" : "";
	return `${ignorePatterns.trimEnd()}${separator}${requiredPatterns.join("\n")}`;
}

function createRequiredIgnorePatterns(configDir: string): string[] {
	return [
		"# Obsidian workspace and cache noise",
		`${configDir}/workspace.json`,
		`${configDir}/workspace-mobile.json`,
		`${configDir}/cache/`,
		"",
		"# Ignore all plugin internals by default",
		`${configDir}/plugins/**`,
		"",
		"# But allow plugin folders and install files",
		`!${configDir}/plugins/`,
		`!${configDir}/plugins/*/`,
		`!${configDir}/plugins/*/manifest.json`,
		`!${configDir}/plugins/*/main.js`,
		`!${configDir}/plugins/*/styles.css`,
		"# Keep these managed outside the vault repo",
		`${configDir}/plugins/github-sync/`,
		`${configDir}/plugins/obsidian42-brat/`,
		`${configDir}/plugins/brat/`,
	];
}

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

export function createDefaultSettings(configDir: string): GitHubSyncSettings {
	return {
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
		ignorePatterns: createDefaultIgnorePatterns(configDir),
		gitattributes: DEFAULT_GITATTRIBUTES,
	};
}
