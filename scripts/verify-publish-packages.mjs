import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishedManifestErrors } from "./publish-package-manifest.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const archiveTool = process.platform === "win32" ? "tar.exe" : "tar";
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-pack-check-"));

function packageDirectories() {
    const directChildren = root =>
        fs
            .readdirSync(path.join(repositoryRoot, root), { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(repositoryRoot, root, entry.name));
    return [
        ...directChildren("packages"),
        ...directChildren("adapters"),
        ...directChildren("protocols").flatMap(directories =>
            fs
                .readdirSync(directories, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => path.join(directories, entry.name)),
        ),
    ].filter(directory => fs.existsSync(path.join(directory, "package.json")));
}

function archiveEntries(archivePath) {
    return execFileSync(archiveTool, ["-tzf", archivePath], { encoding: "utf8" })
        .split(/\r?\n/u)
        .map(entry => entry.trim())
        .filter(Boolean);
}

function archiveManifest(archivePath) {
    return JSON.parse(
        execFileSync(archiveTool, ["-xOf", archivePath, "package/package.json"], {
            encoding: "utf8",
        }),
    );
}

function normalizedPackagePath(file) {
    return `package/${file.replace(/^\.\//u, "")}`;
}

function exportEntries(value) {
    if (typeof value === "string") {
        return value.startsWith("./") && !value.includes("*") ? [value] : [];
    }
    if (Array.isArray(value)) return value.flatMap(exportEntries);
    if (value && typeof value === "object") return Object.values(value).flatMap(exportEntries);
    return [];
}

function requiredEntries(manifest) {
    const entries = [manifest.main, manifest.types, ...exportEntries(manifest.exports)];
    if (typeof manifest.bin === "string") entries.push(manifest.bin);
    if (manifest.bin && typeof manifest.bin === "object")
        entries.push(...Object.values(manifest.bin));
    if (manifest.name === "@onebots/web") entries.push("dist/index.html");
    return [...new Set(entries.filter(entry => typeof entry === "string"))].map(
        normalizedPackagePath,
    );
}

function isForbiddenEntry(entry) {
    if (/(?:^|\/)(?:src|node_modules|__tests__|__mocks__|test|tests)(?:\/|$)/u.test(entry))
        return true;
    if (/\.(?:spec|test)\./u.test(entry)) return true;
    return /\.(?:[cm]?ts|tsx|vue)$/u.test(entry) && !/\.d\.(?:[cm]?ts|tsx)$/u.test(entry);
}
const errors = [];
let verified = 0;
let attempted = 0;
let totalEntries = 0;
let totalBytes = 0;

try {
    for (const directory of packageDirectories()) {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
        if (manifest.private) continue;
        const outputDirectory = path.join(temporaryRoot, String(attempted++));
        fs.mkdirSync(outputDirectory);
        try {
            execFileSync(packageManager, ["pack", "--pack-destination", outputDirectory], {
                cwd: directory,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            const archives = fs
                .readdirSync(outputDirectory)
                .filter(file => file.endsWith(".tgz"))
                .map(file => path.join(outputDirectory, file));
            if (archives.length !== 1) {
                throw new Error(`期望生成 1 个 tarball，实际 ${archives.length} 个`);
            }
            const entries = archiveEntries(archives[0]);
            const publishedManifest = archiveManifest(archives[0]);
            const forbidden = entries.filter(isForbiddenEntry);
            const missing = requiredEntries(publishedManifest).filter(
                entry => !entries.includes(entry),
            );
            if (forbidden.length) {
                errors.push(`${manifest.name}: 包含非生产文件 ${forbidden.join(", ")}`);
            }
            if (missing.length) {
                errors.push(`${manifest.name}: 缺少声明入口 ${missing.join(", ")}`);
            }
            for (const error of publishedManifestErrors(manifest, publishedManifest)) {
                errors.push(`${manifest.name}: ${error}`);
            }
            verified++;
            totalEntries += entries.length;
            totalBytes += fs.statSync(archives[0]).size;
        } catch (error) {
            errors.push(
                `${manifest.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
            );
        }
    }
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (errors.length) {
    for (const error of errors) console.error(`✗ ${error}`);
    process.exitCode = 1;
} else {
    console.log(
        `✓ ${verified} 个发布包通过 tarball 边界校验（${totalEntries} 个文件，${(totalBytes / 1024 / 1024).toFixed(2)} MiB）`,
    );
}
