import { App, Modal } from "obsidian";

export type ConnectionCheckStatus = "pass" | "fail" | "skip";

export interface ConnectionCheckResult {
	label: string;
	status: ConnectionCheckStatus;
	detail: string;
}

export class ConnectionTestModal extends Modal {
	constructor(app: App, private readonly results: ConnectionCheckResult[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "GitHub Sync connection test" });

		const listEl = contentEl.createEl("ul");
		for (const result of this.results) {
			const itemEl = listEl.createEl("li");
			itemEl.createSpan({ text: `${this.getStatusMark(result.status)} ${result.label}` });
			if (result.detail.length > 0) {
				itemEl.createEl("div", {
					text: result.detail,
					cls: "setting-item-description",
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private getStatusMark(status: ConnectionCheckStatus): string {
		switch (status) {
			case "pass":
				return "✓";
			case "fail":
				return "✗";
			case "skip":
				return "−";
		}
	}
}
