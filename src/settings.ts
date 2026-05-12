export type PluginTrackingMode = "ignore-all" | "release-files-only" | "custom";

export interface GitHubSyncSettings {
	remoteName: string;
	branchName: string;
	autoSyncEnabled: boolean;
	pluginTrackingMode: PluginTrackingMode;
	watchPluginReleaseFilesForAutoSync: boolean;
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

export function createDefaultIgnorePatterns(configDir: string, pluginTrackingMode: PluginTrackingMode): string {
	return [
		".DS_Store",
		"Thumbs.db",
		"desktop.ini",
		".trash/",
		"",
		...createWorkspaceIgnorePatterns(configDir),
		"",
		...createPluginIgnorePatterns(configDir, pluginTrackingMode),
	].join("\n");
}

export function createDefaultWatchPluginReleaseFilesForAutoSync(pluginTrackingMode: PluginTrackingMode): boolean {
	return pluginTrackingMode === "release-files-only";
}

export function ensureRequiredIgnorePatterns(ignorePatterns: string, configDir: string): string {
	const requiredPatterns = createWorkspaceIgnorePatterns(configDir);
	const existingLines = new Set(ignorePatterns.split(/\r?\n/).map((line) => line.trim()));
	const missingPatterns = requiredPatterns.filter((line) => line.length > 0 && !line.startsWith("#") && !existingLines.has(line));
	if (missingPatterns.length === 0) {
		return ignorePatterns;
	}

	const separator = ignorePatterns.trim().length > 0 ? "\n\n" : "";
	return `${ignorePatterns.trimEnd()}${separator}${requiredPatterns.join("\n")}`;
}

function createWorkspaceIgnorePatterns(configDir: string): string[] {
	return [
		"# Obsidian workspace and cache noise",
		`${configDir}/workspace.json`,
		`${configDir}/workspace-mobile.json`,
		`${configDir}/cache/`,
	];
}

function createPluginIgnorePatterns(configDir: string, pluginTrackingMode: PluginTrackingMode): string[] {
	if (pluginTrackingMode === "release-files-only") {
		return [
			"# Track only plugin release files",
			`${configDir}/plugins/**`,
			`!${configDir}/plugins/`,
			`!${configDir}/plugins/*/`,
			`!${configDir}/plugins/*/manifest.json`,
			`!${configDir}/plugins/*/main.js`,
			`!${configDir}/plugins/*/styles.css`,
			"# Keep manager and sync plugins outside the vault repo",
			`${configDir}/plugins/github-sync/`,
			`${configDir}/plugins/obsidian42-brat/`,
			`${configDir}/plugins/brat/`,
		];
	}

	if (pluginTrackingMode === "custom") {
		return [
			"# Plugin tracking is custom. Edit plugin ignore rules manually.",
			`${configDir}/plugins/`,
		];
	}

	return [
		"# Ignore all plugins by default",
		`${configDir}/plugins/`,
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
	const pluginTrackingMode: PluginTrackingMode = "ignore-all";
	return {
		remoteName: "origin",
		branchName: "main",
		autoSyncEnabled: true,
		pluginTrackingMode,
		watchPluginReleaseFilesForAutoSync: createDefaultWatchPluginReleaseFilesForAutoSync(pluginTrackingMode),
		idleTimeoutSeconds: 10,
		startupPullEnabled: true,
		startupPullDelaySeconds: 5,
		statusBarEnabled: true,
		gitBinaryPath: "",
		commitMessageTemplate: "vault sync: {{timestamp}} [{{device}}]",
		gitUserName: "",
		gitUserEmail: "",
		ignorePatterns: createDefaultIgnorePatterns(configDir, pluginTrackingMode),
		gitattributes: DEFAULT_GITATTRIBUTES,
	};
}
