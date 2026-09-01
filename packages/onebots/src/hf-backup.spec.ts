import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getExtensionPackageCatalogEntry } from "./extension-capability-catalog.js";
import { buildHfExtensionRecovery, HfBackupService } from "./hf-backup.js";

describe("Hugging Face backup", () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        vi.unstubAllEnvs();
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("publishes a bounded data archive and an exact extension recovery catalog", async () => {
        const fixture = createFixture();
        const archive = Buffer.from("compressed-data");
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
        configureHfEnvironment();
        const service = new HfBackupService({}, fixture.root, fixture.configPath, {
            archiveData: () => archive,
            fetcher,
        });

        await expect(service.backupData("port: 7860\n")).resolves.toEqual({
            success: true,
            dataArchiveIncluded: true,
            message: "已备份配置、扩展恢复清单和数据归档",
        });
        const request = fetcher.mock.calls[0]?.[1];
        const body = JSON.parse(String(request?.body)) as {
            files: Array<{ path: string; content: string; encoding?: string }>;
        };
        expect(body.files).toEqual(
            expect.arrayContaining([
                { path: "config_backup.yaml", content: "port: 7860\n" },
                {
                    path: "data_backup.tar.gz",
                    content: archive.toString("base64"),
                    encoding: "base64",
                },
            ]),
        );
        const recoveryFile = body.files.find(file => file.path === "extensions_backup.json");
        expect(JSON.parse(String(recoveryFile?.content))).toEqual(fixture.recovery);
        expect(fetcher).toHaveBeenCalledWith(
            "https://huggingface.co/api/spaces/owner/space/commit/main",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ Authorization: "Bearer hf-secret" }),
            }),
        );
    });

    it("still replaces stale remote state with config and recovery evidence when archiving fails", async () => {
        const fixture = createFixture();
        const logger = { warn: vi.fn() };
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
        configureHfEnvironment();
        const service = new HfBackupService(logger, fixture.root, fixture.configPath, {
            archiveData: () => {
                throw new Error("archive exceeded 15 MiB");
            },
            fetcher,
        });

        await expect(service.backupData("port: 7860\n")).resolves.toEqual({
            success: true,
            dataArchiveIncluded: false,
            message: "已备份配置和扩展恢复清单；完整数据归档超过限制或生成失败",
        });
        const request = fetcher.mock.calls[0]?.[1];
        const body = JSON.parse(String(request?.body)) as {
            files: Array<{ path: string; content: string; encoding?: string }>;
        };
        expect(body.files).toContainEqual({
            path: "data_backup.tar.gz",
            content: "",
            encoding: "base64",
        });
        expect(body.files.find(file => file.path === "extensions_backup.json")).toBeDefined();
        expect(logger.warn).toHaveBeenCalledWith(
            "完整数据归档超过限制或生成失败，改为备份配置与扩展恢复清单",
            { error: expect.any(Error) },
        );
    });

    it("rejects malformed extension state before uploading a misleading recovery file", async () => {
        const fixture = createFixture();
        fs.writeFileSync(fixture.manifestPath, JSON.stringify({ dependencies: [] }));
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
        configureHfEnvironment();
        const service = new HfBackupService({}, fixture.root, fixture.configPath, {
            archiveData: () => Buffer.from("archive"),
            fetcher,
        });

        await expect(service.backupData("port: 7860\n")).resolves.toMatchObject({
            success: false,
            message: expect.stringContaining("dependencies 不是对象"),
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    function createFixture() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-hf-backup-"));
        temporaryDirectories.push(root);
        const configPath = path.join(root, "config.yaml");
        const extensionRoot = path.join(root, "extensions");
        const manifestPath = path.join(extensionRoot, "package.json");
        fs.mkdirSync(extensionRoot);
        fs.writeFileSync(configPath, "port: 7860\n", { mode: 0o600 });
        fs.writeFileSync(
            manifestPath,
            JSON.stringify({
                dependencies: {
                    "@onebots/adapter-qq": "^0.0.1",
                    "@onebots/adapter-kook": "link:/app/adapters/adapter-kook",
                    "untrusted-extension": "1.0.0",
                },
            }),
        );
        const qq = getExtensionPackageCatalogEntry("@onebots/adapter-qq");
        if (!qq) throw new Error("test catalog is missing @onebots/adapter-qq");
        const recovery = {
            schemaVersion: 1,
            packages: { "@onebots/adapter-qq": qq.packageVersion },
        } as const;
        expect(buildHfExtensionRecovery(root)).toEqual(recovery);
        return { root, configPath, manifestPath, recovery };
    }

    function configureHfEnvironment(): void {
        vi.stubEnv("HF_TOKEN", "hf-secret");
        vi.stubEnv("HF_REPO_ID", "owner/space");
    }
});
