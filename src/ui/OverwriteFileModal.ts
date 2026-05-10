import { App, Modal, Setting } from "obsidian";

interface OverwriteFileModalOptions {
	fileName: ".gitignore" | ".gitattributes";
	onConfirm: () => Promise<void>;
}

export class OverwriteFileModal extends Modal {
	constructor(app: App, private readonly options: OverwriteFileModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Overwrite ${this.options.fileName}?` });
		contentEl.createEl("p", {
			text: `${this.options.fileName} already exists in the vault root. Overwriting it will replace the current file with the content from GitHub sync settings.`,
		});

		if (this.options.fileName === ".gitattributes") {
			contentEl.createEl("p", {
				text: "This may cause a one-time line-ending normalization diff the next time Git scans tracked files.",
			});
		}

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Overwrite")
					.setWarning()
					.onClick(() => {
						void this.confirmOverwrite();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async confirmOverwrite(): Promise<void> {
		await this.options.onConfirm();
		this.close();
	}
}
