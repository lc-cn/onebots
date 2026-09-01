import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const HF_ARCHIVE_COMPRESSED_LIMIT_BYTES = 15 * 1024 * 1024;
export const HF_ARCHIVE_EXPANDED_LIMIT_BYTES = 128 * 1024 * 1024;
export const HF_ARCHIVE_ENTRY_LIMIT = 10_000;
export const HF_ARCHIVE_PROCESS_TIMEOUT_MS = 30_000;
const HF_ARCHIVE_LISTING_LIMIT_BYTES = 4 * 1024 * 1024;
const HF_ARCHIVE_ENTRY_PATH_LIMIT_BYTES = 1024;

const defaultRunTar = (args, options) =>
    execFileSync("tar", args, {
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes,
        stdio: ["ignore", "pipe", "pipe"],
    });

export function restoreHfDataArchive({
    archivePath = "/tmp/data_backup.tar.gz",
    targetRoot = "/data",
    compressedLimitBytes = HF_ARCHIVE_COMPRESSED_LIMIT_BYTES,
    expandedLimitBytes = HF_ARCHIVE_EXPANDED_LIMIT_BYTES,
    entryLimit = HF_ARCHIVE_ENTRY_LIMIT,
    timeoutMs = HF_ARCHIVE_PROCESS_TIMEOUT_MS,
    runTar = defaultRunTar,
} = {}) {
    assertPositiveInteger(compressedLimitBytes, "HF 归档压缩大小上限");
    assertPositiveInteger(expandedLimitBytes, "HF 归档展开大小上限");
    assertPositiveInteger(entryLimit, "HF 归档条目上限");
    assertPositiveInteger(timeoutMs, "HF 归档处理超时");
    assertRegularFileWithinLimit(archivePath, compressedLimitBytes);
    assertRegularDirectory(targetRoot, "HF 归档恢复根目录");

    const listingOptions = {
        timeoutMs,
        maxBufferBytes: HF_ARCHIVE_LISTING_LIMIT_BYTES,
    };
    const names = runTarStep(runTar, ["-tzf", archivePath], listingOptions, "目录读取");
    const verbose = runTarStep(runTar, ["-tvzf", archivePath], listingOptions, "类型读取");
    const expectedEntries = validateHfArchiveListings(names, verbose, entryLimit);
    const stagingRoot = fs.mkdtempSync(path.join(targetRoot, ".hf-restore-"));
    fs.chmodSync(stagingRoot, 0o700);
    try {
        runTarStep(
            runTar,
            ["-xzf", archivePath, "-C", stagingRoot],
            { timeoutMs, maxBufferBytes: 64 * 1024 },
            "隔离解压",
        );
        const staging = inspectStagingTree(stagingRoot, expandedLimitBytes, entryLimit);
        assertExtractedEntries(expectedEntries, staging.entries);
        assertSafeOverlayTargets(targetRoot, staging);
        applyPrivateOverlay(targetRoot, staging);
        return {
            entries: staging.entries.length,
            files: staging.files.length,
            bytes: staging.bytes,
        };
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

export function validateHfArchiveListings(namesOutput, verboseOutput, entryLimit) {
    const names = outputLines(namesOutput);
    const verbose = outputLines(verboseOutput);
    if (names.length === 0) throw new Error("HF 数据归档不包含任何条目");
    if (names.length > entryLimit) throw new Error(`HF 数据归档超过 ${entryLimit} 个条目上限`);
    if (verbose.length !== names.length) throw new Error("HF 数据归档名称与类型目录数量不一致");

    const normalizedEntries = [];
    const seen = new Set();
    for (let index = 0; index < names.length; index++) {
        const rawName = names[index];
        const normalized = normalizeArchiveEntry(rawName);
        const type = verbose[index][0];
        if (type !== "-" && type !== "d") {
            throw new Error(`HF 数据归档包含链接或特殊条目: ${normalized || "."}`);
        }
        if (normalized === "") continue;
        if (seen.has(normalized)) throw new Error(`HF 数据归档包含重复条目: ${normalized}`);
        seen.add(normalized);
        normalizedEntries.push(normalized);
    }
    return normalizedEntries.sort();
}

function normalizeArchiveEntry(rawName) {
    if (typeof rawName !== "string" || rawName.length === 0) {
        throw new Error("HF 数据归档包含空路径");
    }
    if (Buffer.byteLength(rawName) > HF_ARCHIVE_ENTRY_PATH_LIMIT_BYTES) {
        throw new Error(`HF 数据归档条目路径超过 ${HF_ARCHIVE_ENTRY_PATH_LIMIT_BYTES} 字节上限`);
    }
    if (/[\0-\x1f\x7f]/u.test(rawName)) throw new Error("HF 数据归档路径包含控制字符");
    if (path.posix.isAbsolute(rawName) || rawName.startsWith("\\")) {
        throw new Error(`HF 数据归档包含绝对路径: ${rawName}`);
    }
    const components = rawName.split("/").filter(component => component && component !== ".");
    if (components.includes("..")) throw new Error(`HF 数据归档路径越界: ${rawName}`);
    if (components[0]?.startsWith(".hf-restore-")) {
        throw new Error(`HF 数据归档占用内部暂存路径: ${rawName}`);
    }
    return components.join("/");
}

function inspectStagingTree(stagingRoot, expandedLimitBytes, entryLimit) {
    const entries = [];
    const directories = [];
    const files = [];
    let bytes = 0;

    const visit = relativeDirectory => {
        const absoluteDirectory = path.join(stagingRoot, relativeDirectory);
        for (const name of fs.readdirSync(absoluteDirectory).sort()) {
            const relative = relativeDirectory ? path.join(relativeDirectory, name) : name;
            const normalized = relative.split(path.sep).join("/");
            const absolute = path.join(stagingRoot, relative);
            const stat = fs.lstatSync(absolute);
            entries.push(normalized);
            if (entries.length > entryLimit) {
                throw new Error(`HF 数据归档展开后超过 ${entryLimit} 个条目上限`);
            }
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
                throw new Error(`HF 数据归档展开后包含链接或特殊条目: ${normalized}`);
            }
            if (stat.isDirectory()) {
                directories.push({ relative: normalized, absolute });
                visit(relative);
                continue;
            }
            if (stat.nlink !== 1) {
                throw new Error(`HF 数据归档展开后包含硬链接条目: ${normalized}`);
            }
            bytes += stat.size;
            if (bytes > expandedLimitBytes) {
                throw new Error(`HF 数据归档展开后超过 ${formatBytes(expandedLimitBytes)} 上限`);
            }
            files.push({ relative: normalized, absolute });
        }
    };
    visit("");
    return { entries: entries.sort(), directories, files, bytes };
}

function assertExtractedEntries(expected, actual) {
    if (
        expected.length !== actual.length ||
        expected.some((entry, index) => entry !== actual[index])
    ) {
        throw new Error("HF 数据归档目录与隔离解压结果不一致");
    }
}

function assertSafeOverlayTargets(targetRoot, staging) {
    for (const directory of staging.directories) {
        assertCompatibleTarget(path.join(targetRoot, directory.relative), "directory");
    }
    for (const file of staging.files) {
        assertCompatibleTarget(path.join(targetRoot, file.relative), "file");
    }
}

function assertCompatibleTarget(targetPath, expectedType) {
    const stat = lstatIfPresent(targetPath);
    if (!stat) return;
    const compatible = expectedType === "directory" ? stat.isDirectory() : stat.isFile();
    if (stat.isSymbolicLink() || !compatible) {
        throw new Error(`HF 数据归档目标类型冲突: ${targetPath}`);
    }
}

function lstatIfPresent(targetPath) {
    try {
        return fs.lstatSync(targetPath);
    } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
    }
}

function applyPrivateOverlay(targetRoot, staging) {
    for (const directory of staging.directories) {
        const target = path.join(targetRoot, directory.relative);
        if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
    }
    for (const file of staging.files) {
        const target = path.join(targetRoot, file.relative);
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        let completed = false;
        try {
            fs.copyFileSync(file.absolute, temporary, fs.constants.COPYFILE_EXCL);
            fs.chmodSync(temporary, 0o600);
            const handle = fs.openSync(temporary, "r+");
            try {
                fs.fsyncSync(handle);
            } finally {
                fs.closeSync(handle);
            }
            fs.renameSync(temporary, target);
            completed = true;
        } finally {
            if (!completed) fs.rmSync(temporary, { force: true });
        }
    }
}

function runTarStep(runTar, args, options, label) {
    try {
        return runTar(args, options);
    } catch (error) {
        const code = error && typeof error === "object" ? error.code : undefined;
        if (code === "ETIMEDOUT") {
            throw new Error(`HF 数据归档${label}超过 ${options.timeoutMs / 1000} 秒，已取消`);
        }
        throw new Error(`HF 数据归档${label}失败`);
    }
}

function outputLines(output) {
    if (typeof output !== "string") throw new Error("HF 数据归档目录输出格式无效");
    const lines = output.split(/\r?\n/u);
    if (lines.at(-1) === "") lines.pop();
    return lines;
}

function assertRegularFileWithinLimit(filePath, limitBytes) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`HF 数据归档不是常规文件: ${filePath}`);
    }
    if (stat.size === 0) throw new Error("HF 数据归档为空");
    if (stat.size > limitBytes) {
        throw new Error(`HF 数据归档超过 ${formatBytes(limitBytes)} 压缩大小上限`);
    }
}

function assertRegularDirectory(directory, label) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label}不是常规目录: ${directory}`);
    }
}

function assertPositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数`);
}

function formatBytes(bytes) {
    if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
    if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
    return `${bytes} 字节`;
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    try {
        const result = restoreHfDataArchive();
        console.log(
            `[onebots-hf-restore] 已验证并恢复数据归档（${result.files} 个文件，${result.bytes} 字节）`,
        );
    } catch (error) {
        console.error(
            `[onebots-hf-restore] ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    }
}
