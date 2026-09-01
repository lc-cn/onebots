import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    HF_ARCHIVE_COMPRESSED_LIMIT_BYTES,
    HF_ARCHIVE_ENTRY_LIMIT,
    HF_ARCHIVE_EXPANDED_LIMIT_BYTES,
    HF_ARCHIVE_PROCESS_TIMEOUT_MS,
    restoreHfDataArchive,
    validateHfArchiveListings,
} from "../../scripts/hf-data-archive-restore.mjs";
import {
    HF_DATA_ARCHIVE_LIMIT_BYTES,
    HF_DATA_ARCHIVE_TIMEOUT_MS,
    HF_DATA_ENTRY_LIMIT,
    HF_DATA_EXPANDED_LIMIT_BYTES,
} from "../../packages/onebots/src/hf-backup.js";

describe("HF data archive restore", () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("keeps backup and restore resource contracts aligned", () => {
        expect(HF_ARCHIVE_COMPRESSED_LIMIT_BYTES).toBe(HF_DATA_ARCHIVE_LIMIT_BYTES);
        expect(HF_ARCHIVE_EXPANDED_LIMIT_BYTES).toBe(HF_DATA_EXPANDED_LIMIT_BYTES);
        expect(HF_ARCHIVE_ENTRY_LIMIT).toBe(HF_DATA_ENTRY_LIMIT);
        expect(HF_ARCHIVE_PROCESS_TIMEOUT_MS).toBe(HF_DATA_ARCHIVE_TIMEOUT_MS);
    });

    it("validates in staging and overlays private regular files without deleting local state", () => {
        const fixture = createArchive({
            "config.yaml": "port: 7860\n",
            "static/asset.txt": "asset",
        });
        const targetRoot = temporaryDirectory("onebots-hf-target-");
        fs.writeFileSync(path.join(targetRoot, "local.txt"), "preserved");

        expect(restoreHfDataArchive({ archivePath: fixture.archivePath, targetRoot })).toEqual({
            entries: 3,
            files: 2,
            bytes: 16,
        });
        expect(fs.readFileSync(path.join(targetRoot, "config.yaml"), "utf8")).toBe("port: 7860\n");
        expect(fs.readFileSync(path.join(targetRoot, "static", "asset.txt"), "utf8")).toBe("asset");
        expect(fs.readFileSync(path.join(targetRoot, "local.txt"), "utf8")).toBe("preserved");
        expect(fs.statSync(path.join(targetRoot, "config.yaml")).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.join(targetRoot, "static")).mode & 0o777).toBe(0o700);
        expect(stagingEntries(targetRoot)).toEqual([]);
    });

    it("rejects symlink entries before extraction can touch the target", () => {
        const root = temporaryDirectory("onebots-hf-archive-");
        const source = path.join(root, "source");
        fs.mkdirSync(source);
        fs.symlinkSync("/etc/passwd", path.join(source, "escape"));
        const archivePath = pack(source, root);
        const targetRoot = temporaryDirectory("onebots-hf-target-");
        fs.writeFileSync(path.join(targetRoot, "known-good"), "safe");

        expect(() => restoreHfDataArchive({ archivePath, targetRoot })).toThrow(
            "HF 数据归档包含链接或特殊条目: escape",
        );
        expect(fs.readFileSync(path.join(targetRoot, "known-good"), "utf8")).toBe("safe");
        expect(stagingEntries(targetRoot)).toEqual([]);
    });

    it("rejects hard-link entries before applying their shared inode", () => {
        const root = temporaryDirectory("onebots-hf-archive-");
        const source = path.join(root, "source");
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, "original"), "secret");
        fs.linkSync(path.join(source, "original"), path.join(source, "alias"));
        const archivePath = pack(source, root);
        const targetRoot = temporaryDirectory("onebots-hf-target-");

        expect(() => restoreHfDataArchive({ archivePath, targetRoot })).toThrow(
            "HF 数据归档包含链接或特殊条目",
        );
        expect(fs.readdirSync(targetRoot)).toEqual([]);
    });

    it("rejects expanded data over the limit before overlaying any file", () => {
        const fixture = createArchive({ "config.yaml": "12345" });
        const targetRoot = temporaryDirectory("onebots-hf-target-");
        fs.writeFileSync(path.join(targetRoot, "config.yaml"), "known-good");

        expect(() =>
            restoreHfDataArchive({
                archivePath: fixture.archivePath,
                targetRoot,
                expandedLimitBytes: 4,
            }),
        ).toThrow("HF 数据归档展开后超过 4 字节 上限");
        expect(fs.readFileSync(path.join(targetRoot, "config.yaml"), "utf8")).toBe("known-good");
        expect(stagingEntries(targetRoot)).toEqual([]);
    });

    it("preflights every destination type before applying the overlay", () => {
        const fixture = createArchive({ "config.yaml": "next", "static/asset.txt": "asset" });
        const targetRoot = temporaryDirectory("onebots-hf-target-");
        fs.writeFileSync(path.join(targetRoot, "config.yaml"), "known-good");
        fs.writeFileSync(path.join(targetRoot, "static"), "conflict");

        expect(() =>
            restoreHfDataArchive({ archivePath: fixture.archivePath, targetRoot }),
        ).toThrow(`HF 数据归档目标类型冲突: ${path.join(targetRoot, "static")}`);
        expect(fs.readFileSync(path.join(targetRoot, "config.yaml"), "utf8")).toBe("known-good");
        expect(fs.readFileSync(path.join(targetRoot, "static"), "utf8")).toBe("conflict");
    });

    it("rejects traversal paths and bounds every tar subprocess", () => {
        expect(() =>
            validateHfArchiveListings(
                "../escape\n",
                "-rw------- 0 root root 1 Jan 1 00:00 ../escape\n",
                10,
            ),
        ).toThrow("HF 数据归档路径越界: ../escape");
        expect(() =>
            validateHfArchiveListings(
                "./.hf-restore-stale/config.yaml\n",
                "-rw------- 0 root root 1 Jan 1 00:00 ./.hf-restore-stale/config.yaml\n",
                10,
            ),
        ).toThrow("HF 数据归档占用内部暂存路径");

        const fixture = createArchive({ "config.yaml": "safe" });
        const targetRoot = temporaryDirectory("onebots-hf-target-");
        const timeoutError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        const runTar = vi.fn(() => {
            throw timeoutError;
        });
        expect(() =>
            restoreHfDataArchive({
                archivePath: fixture.archivePath,
                targetRoot,
                runTar,
            }),
        ).toThrow("HF 数据归档目录读取超过 30 秒，已取消");
        expect(runTar).toHaveBeenCalledWith(["-tzf", fixture.archivePath], {
            timeoutMs: 30_000,
            maxBufferBytes: 4 * 1024 * 1024,
        });
    });

    function createArchive(files: Record<string, string>) {
        const root = temporaryDirectory("onebots-hf-archive-");
        const source = path.join(root, "source");
        fs.mkdirSync(source);
        for (const [relative, content] of Object.entries(files)) {
            const target = path.join(source, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        }
        return { archivePath: pack(source, root) };
    }

    function temporaryDirectory(prefix: string): string {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        temporaryDirectories.push(directory);
        return directory;
    }
});

function pack(source: string, root: string): string {
    const archivePath = path.join(root, "data.tar.gz");
    execFileSync("tar", ["-czf", archivePath, "-C", source, "."]);
    return archivePath;
}

function stagingEntries(targetRoot: string): string[] {
    return fs.readdirSync(targetRoot).filter(entry => entry.startsWith(".hf-restore-"));
}
