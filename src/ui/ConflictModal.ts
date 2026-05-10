import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { GitCommandResult } from "../git/GitTypes";

interface ElectronShell {
	openPath(path: string): Promise<string>;
}

interface ElectronModule {
	shell: ElectronShell;
}

declare const require: (moduleName: string) => ElectronModule;

export interface ConflictModalOptions {
	conflictedFiles: string[];
	rawResult?: GitCommandResult;
	vaultPath: string;
	getUnresolvedFiles: () => Promise<string[]>;
	retrySync: () => Promise<void>;
}

export class ConflictModal extends Modal {
	constructor(app: App, private readonly options: ConflictModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Git conflicts detected" });
		contentEl.createEl("p", {
			text: "Git stopped because the same files changed in different places. The plugin will not choose a version or overwrite anything. Resolve the files manually, then retry sync.",
		});

		contentEl.createEl("h3", { text: "Conflicted files" });
		const fileListEl = contentEl.createEl("ul");
		const conflictedFiles = this.options.conflictedFiles.length > 0
			? this.options.conflictedFiles
			: ["No unmerged file names were returned by git."];
		for (const filePath of conflictedFiles) {
			fileListEl.createEl("li", { text: filePath });
		}

		contentEl.createEl("h3", { text: "Terminal steps" });
		const instructionListEl = contentEl.createEl("ol");
		for (const instruction of getConflictInstructions(this.options.conflictedFiles)) {
			instructionListEl.createEl("li", { text: instruction });
		}

		const rawOutputEl = contentEl.createEl("details");
		rawOutputEl.createEl("summary", { text: "Raw Git output" });
		rawOutputEl.createEl("pre", {
			text: this.getRawGitOutput(),
		});

		new Setting(contentEl)
			.addButton((button) =>
				this.configureButton(button, "Copy instructions", () => {
					void this.copyInstructions();
				}),
			)
			.addButton((button) =>
				this.configureButton(button, "Open vault folder", () => {
					void this.openVaultFolder();
				}),
			)
			.addButton((button) =>
				this.configureButton(button, "Retry sync", () => {
					void this.retrySync();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private configureButton(button: ButtonComponent, text: string, onClick: () => void): ButtonComponent {
		return button.setButtonText(text).onClick(onClick);
	}

	private async copyInstructions(): Promise<void> {
		const text = [
			"GitHub sync conflict resolution",
			"",
			...getConflictInstructions(this.options.conflictedFiles).map((instruction, index) => `${index + 1}. ${instruction}`),
			"",
			"Conflicted files:",
			...this.options.conflictedFiles.map((filePath) => `- ${filePath}`),
		].join("\n");

		try {
			await navigator.clipboard.writeText(text);
			new Notice("GitHub sync: conflict instructions copied.");
		} catch {
			new Notice("GitHub sync: could not copy conflict instructions.");
		}
	}

	private async openVaultFolder(): Promise<void> {
		let errorMessage: string;
		try {
			const { shell } = require("electron");
			errorMessage = await shell.openPath(this.options.vaultPath);
		} catch {
			new Notice("GitHub sync: could not open vault folder.");
			return;
		}

		if (errorMessage.length > 0) {
			new Notice(`GitHub sync: could not open vault folder. ${errorMessage}`);
			return;
		}

		new Notice("GitHub sync: opened vault folder.");
	}

	private async retrySync(): Promise<void> {
		const unresolvedFiles = await this.options.getUnresolvedFiles();
		if (unresolvedFiles.length > 0) {
			new Notice(`GitHub sync: ${unresolvedFiles.length} conflicted file(s) still need resolution.`);
			return;
		}

		this.close();
		await this.options.retrySync();
	}

	private getRawGitOutput(): string {
		const result = this.options.rawResult;
		if (result === undefined) {
			return "No raw git output was captured.";
		}

		return [
			`Command: ${result.commandLabel}`,
			`Exit code: ${result.exitCode}`,
			"",
			"stdout:",
			result.stdout.trim().length > 0 ? result.stdout : "<empty>",
			"",
			"stderr:",
			result.stderr.trim().length > 0 ? result.stderr : "<empty>",
		].join("\n");
	}
}

export function getConflictInstructions(conflictedFiles: string[]): string[] {
	const files = conflictedFiles.length > 0 ? conflictedFiles.join(", ") : "the conflicted files";
	return [
		`Open the vault folder in a terminal and inspect ${files}.`,
		"Edit each conflicted file and remove Git conflict markers.",
		"Run git status to confirm what remains unresolved.",
		"Run git add <file> for each resolved file.",
		"If Git says a rebase or merge is still in progress, finish it in the terminal with the command Git recommends, such as git rebase --continue or git merge --continue.",
		"Return to Obsidian and click Retry Sync after git diff --name-only --diff-filter=U is empty.",
	];
}
