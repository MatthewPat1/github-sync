import { spawnSync } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const packageDir = path.join(distDir, "github-sync");
const zipPath = path.join(distDir, "github-sync.zip");
const CRC_TABLE = createCrcTable();

runProductionBuild();
await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(packageDir, { recursive: true });

await copyRequiredFile("manifest.json");
await copyRequiredFile("main.js");
if (await fileExists(path.join(rootDir, "styles.css"))) {
	await copyRequiredFile("styles.css");
}

await writeZip(zipPath, [
	{
		sourcePath: path.join(packageDir, "manifest.json"),
		zipPath: "github-sync/manifest.json",
	},
	{
		sourcePath: path.join(packageDir, "main.js"),
		zipPath: "github-sync/main.js",
	},
	...(await fileExists(path.join(packageDir, "styles.css"))
		? [
				{
					sourcePath: path.join(packageDir, "styles.css"),
					zipPath: "github-sync/styles.css",
				},
			]
		: []),
]);

function runProductionBuild() {
	const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
	const result = spawnSync(npmCommand, ["run", "build"], {
		cwd: rootDir,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

async function copyRequiredFile(fileName) {
	await fs.copyFile(path.join(rootDir, fileName), path.join(packageDir, fileName));
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function writeZip(outputPath, entries) {
	const localFileParts = [];
	const centralDirectoryParts = [];
	let offset = 0;

	for (const entry of entries) {
		const data = await fs.readFile(entry.sourcePath);
		const fileName = Buffer.from(entry.zipPath.replaceAll("\\", "/"), "utf8");
		const crc = crc32(data);
		const dosDateTime = getDosDateTime(new Date());

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0, 6);
		localHeader.writeUInt16LE(0, 8);
		localHeader.writeUInt16LE(dosDateTime.time, 10);
		localHeader.writeUInt16LE(dosDateTime.date, 12);
		localHeader.writeUInt32LE(crc, 14);
		localHeader.writeUInt32LE(data.length, 18);
		localHeader.writeUInt32LE(data.length, 22);
		localHeader.writeUInt16LE(fileName.length, 26);
		localHeader.writeUInt16LE(0, 28);

		localFileParts.push(localHeader, fileName, data);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(0, 8);
		centralHeader.writeUInt16LE(0, 10);
		centralHeader.writeUInt16LE(dosDateTime.time, 12);
		centralHeader.writeUInt16LE(dosDateTime.date, 14);
		centralHeader.writeUInt32LE(crc, 16);
		centralHeader.writeUInt32LE(data.length, 20);
		centralHeader.writeUInt32LE(data.length, 24);
		centralHeader.writeUInt16LE(fileName.length, 28);
		centralHeader.writeUInt16LE(0, 30);
		centralHeader.writeUInt16LE(0, 32);
		centralHeader.writeUInt16LE(0, 34);
		centralHeader.writeUInt16LE(0, 36);
		centralHeader.writeUInt32LE(0, 38);
		centralHeader.writeUInt32LE(offset, 42);

		centralDirectoryParts.push(centralHeader, fileName);
		offset += localHeader.length + fileName.length + data.length;
	}

	const centralDirectory = Buffer.concat(centralDirectoryParts);
	const endRecord = Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054b50, 0);
	endRecord.writeUInt16LE(0, 4);
	endRecord.writeUInt16LE(0, 6);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectory.length, 12);
	endRecord.writeUInt32LE(offset, 16);
	endRecord.writeUInt16LE(0, 20);

	await fs.writeFile(outputPath, Buffer.concat([...localFileParts, centralDirectory, endRecord]));
}

function getDosDateTime(date) {
	const year = Math.max(date.getFullYear(), 1980);
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
	}

	return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}

	return table;
}
