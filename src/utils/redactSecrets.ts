const SECRET_PATTERNS: RegExp[] = [
	/ghp_[A-Za-z0-9_]{20,}/g,
	/github_pat_[A-Za-z0-9_]+/g,
	/(https?:\/\/)([^:\s/]+):([^@\s/]+)@/g,
	/([?&](?:token|access_token|password)=)[^&\s]+/gi,
];

export function redactSecrets(value: string): string {
	let redacted = value;
	for (const pattern of SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, (_match: string, prefix?: string) => {
			if (typeof prefix === "string" && prefix.startsWith("http")) {
				return `${prefix}<redacted>@`;
			}

			if (typeof prefix === "string" && prefix.startsWith("?")) {
				return `${prefix}<redacted>`;
			}

			if (typeof prefix === "string" && prefix.startsWith("&")) {
				return `${prefix}<redacted>`;
			}

			return "<redacted>";
		});
	}

	return redacted;
}
