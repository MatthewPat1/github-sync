import { App, Modal } from "obsidian";

export class ConflictModal extends Modal {
	constructor(app: App, private readonly conflictedFiles: string[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Git conflicts detected" });
		contentEl.createEl("p", {
			text: "Resolve these files manually, then run sync again.",
		});

		const listEl = contentEl.createEl("ul");
		for (const filePath of this.conflictedFiles) {
			listEl.createEl("li", { text: filePath });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
