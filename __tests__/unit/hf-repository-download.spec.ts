import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    downloadHfRepositoryArtifact,
    HF_RESTORE_ARTIFACTS,
    hfRepositoryDownloadErrorMessage,
} from "../../scripts/hf-repository-download.mjs";

describe("HF repository restore download", () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("publishes fixed size contracts for every supported restore artifact", () => {
        expect(HF_RESTORE_ARTIFACTS).toEqual({
            "data_backup.tar.gz": {
                targetPath: "/tmp/data_backup.tar.gz",
                maxBytes: 15 * 1024 * 1024,
            },
            "config_backup.yaml": {
                targetPath: "/data/config.yaml",
                maxBytes: 1024 * 1024,
            },
            "extensions_backup.json": {
                targetPath: "/data/extensions/hf-restore.json",
                maxBytes: 1024 * 1024,
            },
        });
        expect(Object.isFrozen(HF_RESTORE_ARTIFACTS)).toBe(true);
        expect(
            Object.values(HF_RESTORE_ARTIFACTS).every(contract => Object.isFrozen(contract)),
        ).toBe(true);
    });

    it("streams a trusted artifact to an atomic private file with a fixed timeout", async () => {
        const root = temporaryDirectory();
        const targetPath = path.join(root, "config.yaml");
        fs.writeFileSync(targetPath, "old-config", { mode: 0o644 });
        const signal = new AbortController().signal;
        const createSignal = vi.fn(() => signal);
        const fetcher = vi.fn<typeof fetch>(async () =>
            responseFromChunks(["new-", "config"], { "content-length": "10" }),
        );

        await expect(
            downloadHfRepositoryArtifact({
                repoId: "owner/space",
                token: "hf-secret",
                artifact: "config_backup.yaml",
                targetPath,
                maxBytes: 1024,
                fetcher,
                createSignal,
            }),
        ).resolves.toEqual({ artifact: "config_backup.yaml", targetPath, bytes: 10 });

        expect(fs.readFileSync(targetPath, "utf8")).toBe("new-config");
        expect(fs.statSync(targetPath).mode & 0o777).toBe(0o600);
        expect(createSignal).toHaveBeenCalledWith(60_000);
        expect(fetcher).toHaveBeenCalledWith(
            "https://huggingface.co/spaces/owner/space/resolve/main/config_backup.yaml",
            expect.objectContaining({
                headers: { Authorization: "Bearer hf-secret" },
                redirect: "follow",
                signal,
            }),
        );
        expect(fs.readdirSync(root)).toEqual(["config.yaml"]);
    });

    it("rejects a declared oversized artifact without replacing the existing target", async () => {
        const root = temporaryDirectory();
        const targetPath = path.join(root, "config.yaml");
        fs.writeFileSync(targetPath, "known-good");
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
        const fetcher = vi.fn<typeof fetch>(async () =>
            Promise.resolve(new Response(body, { headers: { "content-length": String(1025) } })),
        );

        await expect(
            downloadHfRepositoryArtifact({
                repoId: "owner/space",
                artifact: "config_backup.yaml",
                targetPath,
                maxBytes: 1024,
                fetcher,
            }),
        ).rejects.toThrow("HF 恢复制品 config_backup.yaml 超过 1 KiB 上限");
        expect(cancelled).toHaveBeenCalledOnce();
        expect(fs.readFileSync(targetPath, "utf8")).toBe("known-good");
        expect(fs.readdirSync(root)).toEqual(["config.yaml"]);
    });

    it("stops a chunked response at the actual byte limit and cleans its temporary file", async () => {
        const root = temporaryDirectory();
        const targetPath = path.join(root, "extensions.json");
        const fetcher = vi.fn<typeof fetch>(async () => responseFromChunks(["1234", "5"]));

        await expect(
            downloadHfRepositoryArtifact({
                repoId: "owner/space",
                artifact: "extensions_backup.json",
                targetPath,
                maxBytes: 4,
                fetcher,
            }),
        ).rejects.toThrow("HF 恢复制品 extensions_backup.json 超过 4 字节 上限");
        expect(fs.existsSync(targetPath)).toBe(false);
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it("preserves a stable timeout diagnostic and rejects unsafe output targets", async () => {
        const root = temporaryDirectory();
        const outside = temporaryDirectory();
        const linkedParent = path.join(root, "linked");
        fs.symlinkSync(outside, linkedParent, "dir");
        const timeout = new DOMException("expired", "TimeoutError");

        expect(hfRepositoryDownloadErrorMessage(timeout)).toBe("下载超过 60 秒，已取消");
        await expect(
            downloadHfRepositoryArtifact({
                repoId: "owner/space",
                artifact: "config_backup.yaml",
                targetPath: path.join(linkedParent, "config.yaml"),
                maxBytes: 1024,
                fetcher: vi.fn<typeof fetch>(),
            }),
        ).rejects.toThrow(`HF 恢复目标父目录不是常规目录: ${linkedParent}`);
        expect(fs.readdirSync(outside)).toEqual([]);
    });

    function temporaryDirectory(): string {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-hf-download-"));
        temporaryDirectories.push(directory);
        return directory;
    }
});

function responseFromChunks(chunks: string[], headers: Record<string, string> = {}): Response {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        }),
        { headers },
    );
}
