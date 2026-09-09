import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapManagerService } from "./manager-service-bootstrap.js";
import { controlManagerService } from "./manager-service-controller.js";
import { installManagerServiceWhileLocked } from "./manager-service-install.js";
import { uninstallManagerService } from "./manager-service-uninstall.js";
import { inspectManagerServiceStatus } from "./manager-service-status.js";
import { getServiceFiles } from "./service-files.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import { WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE } from "./windows-manager-support.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "onebots-windows-disabled-")));
    roots.push(root);
    const host: ServiceHost = {
        platform: "win32",
        homedir: root,
        isElevated: true,
        windowsSid: "S-1-5-21-100-200-300-1001",
        env: { ProgramData: path.join(root, "program-data") },
        exec: vi.fn(() => {
            throw new Error("SCM must not run");
        }),
        spawn: vi.fn(async () => {
            throw new Error("process must not run");
        }),
    };
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "system",
        workspace: path.join(root, "workspace"),
        nodePath: process.execPath,
        binPath: process.execPath,
        workingDirectory: root,
        host: "127.0.0.1",
        port: 6727,
    };
    return { root, host, spec };
}

describe("Windows顶层管理事务门禁", () => {
    it("安装、启停和卸载都在文件与SCM副作用前拒绝", async () => {
        for (const action of [
            async (f: ReturnType<typeof fixture>) =>
                installManagerServiceWhileLocked(f.spec, "install-1", f.host),
            async (f: ReturnType<typeof fixture>) =>
                controlManagerService("start", "system", f.host),
            async (f: ReturnType<typeof fixture>) => uninstallManagerService("system", f.host),
        ]) {
            const f = fixture();
            const before = readdirSync(f.root);
            await expect(action(f)).rejects.toThrow(WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE);
            expect(readdirSync(f.root)).toEqual(before);
            expect(f.host.exec).not.toHaveBeenCalled();
            expect(f.host.spawn).not.toHaveBeenCalled();
        }
    });

    it("完整bootstrap在下载、候选目录和SCM动作前拒绝", async () => {
        const f = fixture();
        const before = readdirSync(f.root);
        await expect(
            bootstrapManagerService(
                {
                    service: {
                        schemaVersion: 1,
                        runtimeKind: "control",
                        scope: "system",
                        workspace: f.spec.workspace,
                        nodePath: f.spec.nodePath,
                        host: f.spec.host,
                        port: f.spec.port,
                    },
                },
                {
                    artifacts: {
                        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
                        core: { name: "@onebots/core", version: "1.2.12", spec: "1.2.12" },
                    },
                    download: vi.fn(async () => {
                        throw new Error("download must not run");
                    }),
                },
                f.host,
            ),
        ).rejects.toThrow(WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE);
        expect(readdirSync(f.root)).toEqual(before);
        expect(f.host.exec).not.toHaveBeenCalled();
    });

    it("status明确报告控制面禁用且不读取不完整SCM状态", async () => {
        const f = fixture();
        const files = getServiceFiles("system", f.host);
        mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
        writeFileSync(files.metadata, JSON.stringify(f.spec), { mode: 0o600 });
        const status = await inspectManagerServiceStatus("system", f.host);
        expect(status.installation).toBe("control");
        expect(status.diagnostic).toBe("platform-control-unavailable");
        expect(status.manager).toMatchObject({ state: "unknown", ipc: "not-queried" });
        expect(f.host.exec).not.toHaveBeenCalled();
    });
});
