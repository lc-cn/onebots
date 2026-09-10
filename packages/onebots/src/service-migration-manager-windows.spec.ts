import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
    status: vi.fn(),
    request: vi.fn(),
}));

vi.mock("./windows-host-control-client.js", () => ({
    WindowsHostControlClient: class {
        status = native.status;
        request = native.request;
    },
}));

import { inspectMigrationManager } from "./service-migration-manager.js";

const manager = { id: randomUUID(), version: "1.2.3", pid: 4321 };
const gateway = { desired: "stopped" as const, actual: "stopped" as const };

function nativeStatus(revision: number) {
    return {
        version: 2 as const,
        requestId: `status:${revision}`,
        ok: true as const,
        state: {
            service: "running" as const,
            manager: { state: "running" as const, pid: manager.pid },
            startedAt: "2026-09-10T00:00:00Z",
            control: {
                revision,
                publishedAt: `2026-09-10T00:00:0${revision}Z`,
                manager,
                gateway,
            },
        },
    };
}

function controlStatus() {
    return {
        schemaVersion: 1,
        manager,
        gateway: { ...gateway, recoveryRequired: false, operations: [] },
        serviceMigration: { pending: false, recoveryRequired: false },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    native.status.mockReset();
    native.request.mockReset();
});

describe("Windows 迁移 manager 原生身份绑定", () => {
    it("允许同一管理实例在只读请求期间推进状态 revision", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        native.status.mockResolvedValueOnce(nativeStatus(1)).mockResolvedValueOnce(nativeStatus(2));
        native.request.mockResolvedValue({ status: 200, body: controlStatus() });

        await expect(inspectMigrationManager("C:\\ProgramData\\OneBots")).resolves.toMatchObject({
            manager,
            gateway: { desired: "stopped", actual: "stopped" },
        });
        expect(native.request).toHaveBeenCalledWith("GET", "/api/control/status");
    });

    it("拒绝请求期间原生宿主管理进程身份漂移", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        const after = nativeStatus(2);
        after.state.manager.pid += 1;
        after.state.control.manager = { ...manager, pid: manager.pid + 1 };
        native.status.mockResolvedValueOnce(nativeStatus(1)).mockResolvedValueOnce(after);
        native.request.mockResolvedValue({ status: 200, body: controlStatus() });

        await expect(inspectMigrationManager("C:\\ProgramData\\OneBots")).rejects.toThrow(
            "状态无法确认",
        );
    });
});
