import { spawnSync } from "node:child_process";
import process from "node:process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "manifest.json");
const packageJsonPath = path.join(rootDir, "package.json");
const packageLockPath = path.join(rootDir, "package-lock.json");
const versionsPath = path.join(rootDir, "versions.json");
const releaseFiles = ["manifest.json", "package.json", "package-lock.json", "versions.json"];
const semverPattern = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionArgument = args.find((arg) => arg !== "--dry-run");

if (versionArgument === undefined || args.some((arg) => arg !== "--dry-run" && arg !== versionArgument)) {
	fail("Usage: npm run release:prepare -- <patch|minor|major|X.Y.Z> [--dry-run]");
}

await ensureCleanWorkingTree();
await ensureCurrentBranchIsMain();

const manifest = await readJson(manifestPath);
const packageJson = await readJson(packageJsonPath);
const packageLock = await readJson(packageLockPath);
const versions = await readJson(versionsPath);
const currentVersion = getRequiredString(manifest, "version", "manifest.json");
const packageVersion = getRequiredString(packageJson, "version", "package.json");
const minAppVersion = getRequiredString(manifest, "minAppVersion", "manifest.json");

if (!semverPattern.test(currentVersion)) {
	fail(`manifest.json version must be exact semver X.Y.Z. Found: ${currentVersion}`);
}

if (packageVersion !== currentVersion) {
	fail(`package.json version (${packageVersion}) must match manifest.json version (${currentVersion}).`);
}

const nextVersion = calculateNextVersion(currentVersion, versionArgument);
if (compareVersions(nextVersion, currentVersion) <= 0) {
	fail(`Next version (${nextVersion}) must be greater than current version (${currentVersion}).`);
}

await ensureLocalTagDoesNotExist(nextVersion);
await ensureRemoteTagDoesNotExist(nextVersion);

if (dryRun) {
	printDryRun(currentVersion, nextVersion, minAppVersion);
	process.exit(0);
}

manifest.version = nextVersion;
packageJson.version = nextVersion;
packageLock.version = nextVersion;
if (isRecord(packageLock.packages) && isRecord(packageLock.packages[""])) {
	packageLock.packages[""].version = nextVersion;
}
versions[nextVersion] = minAppVersion;

await writeJson(manifestPath, manifest);
await writeJson(packageJsonPath, packageJson);
await writeJson(packageLockPath, packageLock);
await writeJson(versionsPath, versions);

run("npm", ["install", "--package-lock-only"]);
run("npm", ["run", "lint"]);
run("npm", ["run", "build"]);
run("npm", ["run", "package"]);

await ensureFileExists(path.join(rootDir, "dist", "github-sync", "manifest.json"));
await ensureFileExists(path.join(rootDir, "dist", "github-sync", "main.js"));
await ensureFileExists(path.join(rootDir, "dist", "github-sync.zip"));

run("git", ["add", "--", ...releaseFiles]);
run("git", ["commit", "-m", `release: ${nextVersion}`]);
run("git", ["push", "origin", "main"]);
run("git", ["tag", nextVersion]);
run("git", ["push", "origin", nextVersion]);

console.log(`Release ${nextVersion} prepared and pushed. GitHub Actions will create the release.`);

async function ensureCleanWorkingTree() {
	const result = run("git", ["status", "--porcelain"], { capture: true });
	if (result.stdout.trim().length > 0) {
		fail("Working tree is dirty. Commit or stash changes before preparing a release.");
	}
}

async function ensureCurrentBranchIsMain() {
	const result = run("git", ["branch", "--show-current"], { capture: true });
	const branch = result.stdout.trim();
	if (branch !== "main") {
		fail(`Release preparation must run from main. Current branch: ${branch || "<none>"}`);
	}
}

async function ensureLocalTagDoesNotExist(version) {
	const result = spawnGit(["rev-parse", "-q", "--verify", `refs/tags/${version}`], { capture: true });
	if (result.status === 0) {
		fail(`Local tag already exists: ${version}`);
	}
}

async function ensureRemoteTagDoesNotExist(version) {
	const result = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${version}`], { capture: true });
	if (result.stdout.trim().length > 0) {
		fail(`Remote tag already exists on origin: ${version}`);
	}
}

function calculateNextVersion(currentVersion, argument) {
	const [major, minor, patch] = parseVersion(currentVersion);
	if (argument === "patch") {
		return `${major}.${minor}.${patch + 1}`;
	}

	if (argument === "minor") {
		return `${major}.${minor + 1}.0`;
	}

	if (argument === "major") {
		return `${major + 1}.0.0`;
	}

	if (!semverPattern.test(argument)) {
		fail(`Custom version must use exact semver X.Y.Z. Found: ${argument}`);
	}

	return argument;
}

function compareVersions(left, right) {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] > rightParts[index]) {
			return 1;
		}

		if (leftParts[index] < rightParts[index]) {
			return -1;
		}
	}

	return 0;
}

function parseVersion(version) {
	if (!semverPattern.test(version)) {
		fail(`Invalid version: ${version}`);
	}

	return version.split(".").map((part) => Number.parseInt(part, 10));
}

function printDryRun(currentVersion, nextVersion, minAppVersion) {
	console.log(`Dry run: would prepare release ${nextVersion} from ${currentVersion}.`);
	console.log(`Would update manifest.json and package.json to ${nextVersion}.`);
	console.log("Would run npm install --package-lock-only to update package-lock.json.");
	console.log(`Would add versions.json entry "${nextVersion}": "${minAppVersion}".`);
	console.log("Would run npm run lint, npm run build, and npm run package.");
	console.log("Would verify dist/github-sync/manifest.json, dist/github-sync/main.js, and dist/github-sync.zip.");
	console.log(`Would commit only ${releaseFiles.join(", ")} with message "release: ${nextVersion}".`);
	console.log("Would push origin main, create the local tag, and push origin tag.");
}

async function readJson(filePath) {
	const content = await fs.readFile(filePath, "utf8");
	return JSON.parse(content);
}

async function writeJson(filePath, value) {
	await fs.writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

async function ensureFileExists(filePath) {
	try {
		await fs.access(filePath, constants.F_OK);
	} catch {
		fail(`Expected release artifact was not created: ${path.relative(rootDir, filePath)}`);
	}
}

function getRequiredString(record, key, fileName) {
	if (!isRecord(record) || typeof record[key] !== "string") {
		fail(`${fileName} must contain string field: ${key}`);
	}

	return record[key];
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(command, args, options = {}) {
	const result = spawnSync(getExecutable(command), args, {
		cwd: rootDir,
		encoding: "utf8",
		stdio: options.capture === true ? "pipe" : "inherit",
	});

	if (result.error !== undefined) {
		fail(`${command} ${args.join(" ")} failed: ${result.error.message}`);
	}

	if (result.status !== 0) {
		fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
	}

	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function spawnGit(args, options = {}) {
	return spawnSync(getExecutable("git"), args, {
		cwd: rootDir,
		encoding: "utf8",
		stdio: options.capture === true ? "pipe" : "inherit",
	});
}

function getExecutable(command) {
	if (command === "npm" && process.platform === "win32") {
		return "npm.cmd";
	}

	return command;
}

function fail(message) {
	console.error(`Release preparation failed: ${message}`);
	process.exit(1);
}
