import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectManagerServiceStatus } from "./manager-service-status.js";
import { getServiceFiles } from "./service-files.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import {
    assertManagerServiceTransactionsSupported,
    WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE,
} from "./windows-manager-support.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";

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
    it("只允许管理员和已确认SID进入Windows system事务", () => {
        const f = fixture();
        expect(() => assertManagerServiceTransactionsSupported(f.host)).not.toThrow();
        for (const host of [
            { ...f.host, isElevated: false },
            { ...f.host, windowsSid: undefined },
            { ...f.host, windowsSid: "Administrators" },
        ]) {
            expect(() => assertManagerServiceTransactionsSupported(host)).toThrow(
                WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE,
            );
        }
        expect(readdirSync(f.root)).toEqual([]);
        expect(f.host.exec).not.toHaveBeenCalled();
    });

    it("status从原生宿主管道读取同一manager与gateway状态", async () => {
        const f = fixture();
        const files = getServiceFiles("system", f.host);
        mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
        writeFileSync(files.metadata, JSON.stringify(f.spec), { mode: 0o600 });
        writeFileSync(
            files.definition,
            renderInstalledManagerService(f.spec, "win32", files.stateDir),
            { mode: 0o600 },
        );
        const observation = {
            service: {
                state: "running" as const,
                running: true,
                enabled: true,
                loaded: true,
                definitionPath: files.definition,
                processId: 8765,
                identity: "2026-09-10T01:02:03Z/host:4321/manager:8765",
                quiescent: false,
            },
            control: {
                revision: 1,
                publishedAt: "2026-09-10T01:02:03Z",
                manager: {
                    id: "123e4567-e89b-42d3-a456-426614174000",
                    version: "1.2.12",
                    pid: 8765,
                },
                gateway: { desired: "running" as const, actual: "stopped" as const },
            },
        };
        const inspectNative = vi.fn(async () => structuredClone(observation));
        const status = await inspectManagerServiceStatus("system", f.host, {
            windowsPlatform: () => ({ inspectNative }),
            now: () => Date.parse("2026-09-10T01:02:04Z"),
        });
        expect(status.installation).toBe("control");
        expect(status.diagnostic).toBeNull();
        expect(status.manager).toMatchObject({ state: "running", pid: 8765, ipc: "available" });
        expect(status.gateway).toEqual({
            desired: "running",
            actual: "stopped",
            recoveryRequired: null,
            knownConfigurationFailure: null,
        });
        expect(inspectNative).toHaveBeenCalledTimes(2);
        expect(f.host.exec).not.toHaveBeenCalled();

        observation.control.manager.pid = 9;
        const mismatched = await inspectManagerServiceStatus("system", f.host, {
            windowsPlatform: () => ({ inspectNative }),
            now: () => Date.parse("2026-09-10T01:02:04Z"),
        });
        expect(mismatched.diagnostic).toBe("identity-mismatch");
        expect(mismatched.manager.ipc).toBe("mismatch");

        observation.control.manager.pid = 8765;
        observation.control.manager.version = "latest";
        expect(
            (
                await inspectManagerServiceStatus("system", f.host, {
                    windowsPlatform: () => ({ inspectNative }),
                    now: () => Date.parse("2026-09-10T01:02:04Z"),
                })
            ).diagnostic,
        ).toBe("identity-mismatch");

        observation.control.manager.version = "1.2.12";
        expect(
            (
                await inspectManagerServiceStatus("system", f.host, {
                    windowsPlatform: () => ({ inspectNative }),
                    now: () => Date.parse("2026-09-10T01:03:00Z"),
                })
            ).diagnostic,
        ).toBe("ipc-unavailable");
    });

    it("运行中宿主尚无manager发布时保持gateway未知", async () => {
        const f = fixture();
        const files = getServiceFiles("system", f.host);
        mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
        writeFileSync(files.metadata, JSON.stringify(f.spec), { mode: 0o600 });
        writeFileSync(
            files.definition,
            renderInstalledManagerService(f.spec, "win32", files.stateDir),
            { mode: 0o600 },
        );
        const service = {
            state: "running" as const,
            running: true,
            enabled: true,
            loaded: true,
            definitionPath: files.definition,
            processId: 8765,
            identity: "2026-09-10T01:02:03Z/host:4321/manager:8765",
            quiescent: false,
        };
        const status = await inspectManagerServiceStatus("system", f.host, {
            windowsPlatform: () => ({
                inspectNative: vi.fn(async () => ({ service: structuredClone(service) })),
            }),
        });
        expect(status.diagnostic).toBe("ipc-unavailable");
        expect(status.manager.ipc).toBe("unavailable");
        expect(status.gateway.actual).toBe("unknown");
    });
});
