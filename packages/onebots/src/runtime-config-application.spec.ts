import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ConfigRestartRequiredError,
    HostConfigRestartRequiredError,
    writeConfigFileAtomic,
} from "@onebots/core";
import {
    applyRuntimeConfigFile,
    RuntimeConfigApplicationConflictError,
    RuntimeConfigRollbackConflictError,
    saveAndApplyRuntimeConfig,
} from "./runtime-config-application.js";
import { RuntimeConfigStateTracker } from "./runtime-config-state.js";

const directories: string[] = [];

function configFile(content = "access_token: old-token\n"): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-apply-"));
    directories.push(directory);
    const file = path.join(directory, "config.yaml");
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
}

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("runtime config application", () => {
    it("保存后立即热重载并保留上一版本备份", async () => {
        const file = configFile();
        const host = {
            isReloading: false,
            reload: vi.fn(async () => undefined),
            markRuntimeConfigApplied: vi.fn(),
        };

        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file),
        ).resolves.toEqual({ applied: true, restartRequired: false, changedHostFields: [] });
        expect(host.reload).toHaveBeenCalledWith({ access_token: "next-token" });
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: next-token\n");
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("access_token: old-token\n");
        expect(host.markRuntimeConfigApplied).toHaveBeenCalledWith(
            file,
            "access_token: next-token\n",
        );
    });

    it("宿主字段变更保留文件并明确要求重启", async () => {
        const file = configFile();
        const host = {
            isReloading: false,
            markRuntimeConfigApplied: vi.fn(),
            reload: vi.fn(async () => {
                throw new HostConfigRestartRequiredError(["port"]);
            }),
        };

        await expect(saveAndApplyRuntimeConfig(host, "port: 7000\n", file)).resolves.toEqual({
            applied: false,
            restartRequired: true,
            changedHostFields: ["port"],
        });
        expect(fs.readFileSync(file, "utf8")).toBe("port: 7000\n");
        expect(host.markRuntimeConfigApplied).not.toHaveBeenCalled();
    });

    it("应用层扩展字段也复用结构化重启边界", async () => {
        const file = configFile("plugins:\n  adapters: [mock]\n");
        const host = {
            isReloading: false,
            reload: vi.fn(async () => {
                throw new ConfigRestartRequiredError(["plugins"]);
            }),
            markRuntimeConfigApplied: vi.fn(),
        };

        await expect(
            saveAndApplyRuntimeConfig(host, "plugins:\n  adapters: [qq]\n", file),
        ).resolves.toEqual({
            applied: false,
            restartRequired: true,
            changedHostFields: ["plugins"],
        });
        expect(host.markRuntimeConfigApplied).not.toHaveBeenCalled();
    });

    it("运行态应用失败时恢复旧文件与可用备份", async () => {
        const file = configFile();
        const host = {
            isReloading: false,
            markRuntimeConfigApplied: vi.fn(),
            reload: vi.fn(async () => {
                throw new Error("适配器初始化失败");
            }),
        };

        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file),
        ).rejects.toThrow("适配器初始化失败");
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: old-token\n");
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("access_token: old-token\n");
        expect(host.markRuntimeConfigApplied).not.toHaveBeenCalled();
    });

    it("运行态应用失败时不覆盖另一进程已经写入的新配置", async () => {
        const file = configFile();
        const concurrent = "access_token: external-token\nlog_level: debug\n";
        const host = {
            isReloading: false,
            markRuntimeConfigApplied: vi.fn(),
            reload: vi.fn(async () => {
                writeConfigFileAtomic(file, concurrent);
                throw new Error("适配器初始化失败");
            }),
        };

        const failure = await saveAndApplyRuntimeConfig(
            host,
            "access_token: next-token\n",
            file,
        ).then(
            () => null,
            error => error,
        );

        expect(failure).toBeInstanceOf(RuntimeConfigRollbackConflictError);
        expect((failure as AggregateError).message).toBe(
            "配置应用失败，且磁盘配置已被另一操作更新；已保留最新文件",
        );
        expect((failure as AggregateError).errors).toEqual([
            expect.objectContaining({ message: "适配器初始化失败" }),
            expect.objectContaining({
                message: expect.stringContaining("配置在运行时预检后发生变化"),
            }),
        ]);
        expect(fs.readFileSync(file, "utf8")).toBe(concurrent);
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("access_token: old-token\n");
        expect(host.markRuntimeConfigApplied).not.toHaveBeenCalled();
    });

    it("重载进行中拒绝写盘", async () => {
        const file = configFile();
        const host = { isReloading: true, reload: vi.fn(async () => undefined) };

        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file),
        ).rejects.toBeInstanceOf(RuntimeConfigApplicationConflictError);
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: old-token\n");
        expect(host.reload).not.toHaveBeenCalled();
    });

    it("在 reload 标志更新前也拒绝并发保存", async () => {
        const file = configFile();
        let releaseReload: (() => void) | undefined;
        const reloadPending = new Promise<void>(resolve => {
            releaseReload = resolve;
        });
        const host = { isReloading: false, reload: vi.fn(() => reloadPending) };

        const first = saveAndApplyRuntimeConfig(host, "access_token: first-token\n", file);
        await vi.waitFor(() => expect(host.reload).toHaveBeenCalledOnce());
        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: second-token\n", file),
        ).rejects.toBeInstanceOf(RuntimeConfigApplicationConflictError);
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: first-token\n");

        releaseReload?.();
        await first;
    });

    it("从磁盘重新读取配置且不产生新的备份", async () => {
        const file = configFile("access_token: disk-token\n");
        const host = {
            isReloading: false,
            reload: vi.fn(async () => undefined),
            markRuntimeConfigApplied: vi.fn(),
        };

        await expect(applyRuntimeConfigFile(host, file)).resolves.toEqual({
            applied: true,
            restartRequired: false,
            changedHostFields: [],
        });
        expect(host.reload).toHaveBeenCalledWith({ access_token: "disk-token" });
        expect(host.markRuntimeConfigApplied).toHaveBeenCalledWith(
            file,
            "access_token: disk-token\n",
        );
        expect(fs.existsSync(`${file}.bak`)).toBe(false);
    });

    it("重载期间文件再次变化时不会把未应用的新内容记为同步", async () => {
        const file = configFile("access_token: applied-token\n");
        const tracker = new RuntimeConfigStateTracker(file);
        const host = {
            isReloading: false,
            reload: vi.fn(async () => {
                fs.writeFileSync(file, "access_token: external-token\n");
            }),
            markRuntimeConfigApplied: (_path: string, source: string) =>
                tracker.markApplied(source),
        };

        await applyRuntimeConfigFile(host, file);

        expect(tracker.inspect()).toMatchObject({ status: "drifted" });
    });

    it("保存与磁盘重载共享同一个并发锁", async () => {
        const file = configFile();
        let releaseReload: (() => void) | undefined;
        const reloadPending = new Promise<void>(resolve => {
            releaseReload = resolve;
        });
        const host = { isReloading: false, reload: vi.fn(() => reloadPending) };

        const save = saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file);
        await vi.waitFor(() => expect(host.reload).toHaveBeenCalledOnce());
        await expect(applyRuntimeConfigFile(host, file)).rejects.toBeInstanceOf(
            RuntimeConfigApplicationConflictError,
        );

        releaseReload?.();
        await save;
        expect(host.reload).toHaveBeenCalledOnce();
    });
});
