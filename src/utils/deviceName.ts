import os from "os";

export function getDeviceName(): string {
	const hostname = os.hostname().trim();
	return hostname.length > 0 ? hostname : "unknown-device";
}

export function formatCommitMessage(template: string, date: Date = new Date()): string {
	return template
		.split("{{timestamp}}")
		.join(date.toISOString())
		.split("{{device}}")
		.join(getDeviceName());
}
