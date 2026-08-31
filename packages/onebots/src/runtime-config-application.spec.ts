import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostConfigRestartRequiredError } from "@onebots/core";
import {
    RuntimeConfigApplicationConflictError,
    saveAndApplyRuntimeConfig,
} from "./runtime-config-application.js";

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
        const host = { isReloading: false, reload: vi.fn(async () => undefined) };

        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file),
        ).resolves.toEqual({ applied: true, restartRequired: false, changedHostFields: [] });
        expect(host.reload).toHaveBeenCalledWith({ access_token: "next-token" });
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: next-token\n");
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("access_token: old-token\n");
    });

    it("宿主字段变更保留文件并明确要求重启", async () => {
        const file = configFile();
        const host = {
            isReloading: false,
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
    });

    it("运行态应用失败时恢复旧文件与可用备份", async () => {
        const file = configFile();
        const host = {
            isReloading: false,
            reload: vi.fn(async () => {
                throw new Error("适配器初始化失败");
            }),
        };

        await expect(
            saveAndApplyRuntimeConfig(host, "access_token: next-token\n", file),
        ).rejects.toThrow("适配器初始化失败");
        expect(fs.readFileSync(file, "utf8")).toBe("access_token: old-token\n");
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("access_token: old-token\n");
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
});
