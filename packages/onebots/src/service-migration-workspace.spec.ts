import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    prepareServiceMigrationWorkspace,
    blockServiceMigrationWorkspace,
    inspectServiceMigrationRollbackWorkspace,
    readServiceMigrationPending,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ServiceHost } from "./service-host.js";
import {
    inspectWindowsServiceDirectorySecurity,
    inspectWindowsServiceFileSecurity,
    secureWindowsServiceFile,
} from "./windows-service-security.js";
vi.mock("./windows-service-security.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./windows-service-security.js")>()),
    inspectWindowsServiceDirectorySecurity: vi.fn(() => "a".repeat(64)),
    inspectWindowsServiceFileSecurity: vi.fn(() => "b".repeat(64)),
    secureWindowsServiceFile: vi.fn(() => "b".repeat(64)),
}));
const folders: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-workspace-"));
    folders.push(root);
    return root;
}
describe("migration owned workspace seed", () => {
    it("Windows 首次初始化即用同一 ACL 契约创建锁，随后可安全重开", () => {
        const root = fixture();
        const host: ServiceHost = {
            platform: "win32",
            homedir: root,
            env: {},
            isElevated: true,
            windowsSid: "S-1-5-21-100-200-300-1001",
            exec: vi.fn(() => '{"secured":true,"sddl":"TzpTWVNURU0="}'),
            spawn: vi.fn(async () => 0),
        };
        prepareServiceMigrationWorkspace(root, "windows-install", "running", host);
        const release = acquireControlWorkspace(root, host);
        release();
        expect(inspectWindowsServiceDirectorySecurity).toHaveBeenCalled();
        expect(secureWindowsServiceFile).toHaveBeenCalledOnce();
        expect(inspectWindowsServiceFileSecurity).toHaveBeenCalledOnce();
        expect(fs.existsSync(path.join(root, ".control/manager-lock.sqlite"))).toBe(true);
    });

    it.each(["running", "stopped"] as const)(
        "persists %s desired and releases only matching pending under the caller lock",
        desired => {
            const root = fixture();
            const seed = prepareServiceMigrationWorkspace(root, "operation-1", desired);
            expect(readServiceMigrationPending(root)).toEqual(seed);
            const directory = path.join(root, ".control");
            const gateway = path.join(directory, "gateway.json");
            expect(JSON.parse(fs.readFileSync(gateway, "utf8"))).toEqual({
                schemaVersion: 1,
                desired,
                actual: "stopped",
                recoveryRequired: false,
                operations: [],
            });
            expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
            expect(fs.statSync(gateway).mode & 0o777).toBe(0o600);
            expect(fs.statSync(path.join(directory, "migration-pending.json")).mode & 0o777).toBe(
                0o600,
            );
            fs.writeFileSync(path.join(directory, "auth.json"), "synthetic-auth");
            const release = acquireControlWorkspace(root);
            try {
                expect(() => releaseServiceMigrationPending(root, "other-operation")).toThrow();
                releaseServiceMigrationPending(root, "operation-1");
            } finally {
                release();
            }
            expect(readServiceMigrationPending(root)).toBeNull();
            expect(fs.readFileSync(path.join(directory, "auth.json"), "utf8")).toBe(
                "synthetic-auth",
            );
            expect(fs.existsSync(gateway)).toBe(true);
            expect(fs.existsSync(path.join(directory, "manager-lock.sqlite"))).toBe(true);
            expect(() => prepareServiceMigrationWorkspace(root, "operation-2", desired)).toThrow();
        },
    );
    it("readonly absent lookup does not initialize; existing empty/auth workspace cannot be claimed", () => {
        const root = fixture();
        expect(readServiceMigrationPending(root)).toBeNull();
        expect(fs.readdirSync(root)).toEqual([]);
        const directory = path.join(root, ".control");
        fs.mkdirSync(directory);
        expect(() => prepareServiceMigrationWorkspace(root, "operation-1", "running")).toThrow();
        fs.writeFileSync(path.join(directory, "auth.json"), "synthetic-auth");
        expect(() => prepareServiceMigrationWorkspace(root, "operation-1", "running")).toThrow();
        expect(fs.readFileSync(path.join(directory, "auth.json"), "utf8")).toBe("synthetic-auth");
    });
    it("interruption after marker creation leaves a fail-closed trace and releases the SQLite lock", () => {
        const root = fixture();
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            if (String(to).endsWith("gateway.json")) throw new Error("synthetic-secret");
            original(from, to);
        });
        expect(() => prepareServiceMigrationWorkspace(root, "operation-1", "running")).toThrow(
            "迁移工作区已存在",
        );
        expect(readServiceMigrationPending(root)?.operationId).toBe("operation-1");
        vi.restoreAllMocks();
        const release = acquireControlWorkspace(root);
        release();
        expect(() => prepareServiceMigrationWorkspace(root, "operation-1", "running")).toThrow();
    });
    it("rejects corrupted/over-permitted/symlink markers without deleting them", () => {
        const root = fixture();
        prepareServiceMigrationWorkspace(root, "operation-1", "stopped");
        const file = path.join(root, ".control/migration-pending.json");
        fs.chmodSync(file, 0o644);
        expect(() => readServiceMigrationPending(root)).toThrow();
        fs.chmodSync(file, 0o600);
        fs.writeFileSync(file, '{"synthetic-secret":');
        expect(() => readServiceMigrationPending(root)).toThrow("迁移工作区已存在");
        expect(() => releaseServiceMigrationPending(root, "operation-1")).toThrow();
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(root, "absent"), file);
        expect(() => readServiceMigrationPending(root)).toThrow();
        expect(() => releaseServiceMigrationPending(root, "operation-1")).toThrow();
        expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    });
    it("never replaces an externally created seed and keeps its operation marker", () => {
        const root = fixture();
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            if (String(to).endsWith("gateway.json")) fs.writeFileSync(to, "external-state");
            original(from, to);
        });
        expect(() => prepareServiceMigrationWorkspace(root, "operation-1", "running")).toThrow();
        expect(fs.readFileSync(path.join(root, ".control/gateway.json"), "utf8")).toBe(
            "external-state",
        );
        expect(readServiceMigrationPending(root)?.operationId).toBe("operation-1");
    });
});

it("rollback blockade preserves pending/auth/gateway and permanently rejects read/release", () => {
    const root = fixture();
    prepareServiceMigrationWorkspace(root, "operation-1", "running");
    const directory = path.join(root, ".control");
    fs.writeFileSync(path.join(directory, "auth.json"), "synthetic-auth");
    const pending = fs.readFileSync(path.join(directory, "migration-pending.json"));
    const gateway = fs.readFileSync(path.join(directory, "gateway.json"));
    const unlock = acquireControlWorkspace(root);
    try {
        expect(() => blockServiceMigrationWorkspace(root, "other-operation")).toThrow();
        expect(fs.existsSync(path.join(directory, "migration-blocked.json"))).toBe(false);
        expect(inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toBe("pending");
        blockServiceMigrationWorkspace(root, "operation-1");
        expect(inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toBe("blocked");
        expect(() => readServiceMigrationPending(root)).toThrow();
        expect(() => releaseServiceMigrationPending(root, "operation-1")).toThrow();
        expect(() => blockServiceMigrationWorkspace(root, "operation-1")).toThrow();
    } finally {
        unlock();
    }
    expect(fs.readFileSync(path.join(directory, "migration-pending.json"))).toEqual(pending);
    expect(fs.readFileSync(path.join(directory, "gateway.json"))).toEqual(gateway);
    expect(fs.readFileSync(path.join(directory, "auth.json"), "utf8")).toBe("synthetic-auth");
    expect(
        JSON.parse(fs.readFileSync(path.join(directory, "migration-blocked.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, operationId: "operation-1" });
    expect(fs.statSync(path.join(directory, "migration-blocked.json")).mode & 0o777).toBe(0o600);
});
it("any blocked trace including corrupted or dangling entries forbids reuse and is never overwritten", () => {
    const root = fixture();
    prepareServiceMigrationWorkspace(root, "operation-1", "stopped");
    const blocked = path.join(root, ".control/migration-blocked.json");
    fs.writeFileSync(blocked, "synthetic-unknown");
    expect(() => blockServiceMigrationWorkspace(root, "operation-1")).toThrow();
    expect(() => inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toThrow();
    expect(fs.readFileSync(blocked, "utf8")).toBe("synthetic-unknown");
    expect(() => readServiceMigrationPending(root)).toThrow();
    expect(() => releaseServiceMigrationPending(root, "operation-1")).toThrow();
    fs.unlinkSync(blocked);
    fs.symlinkSync(path.join(root, "missing"), blocked);
    expect(() => readServiceMigrationPending(root)).toThrow();
    expect(() => releaseServiceMigrationPending(root, "operation-1")).toThrow();
    expect(() => blockServiceMigrationWorkspace(root, "operation-1")).toThrow();
    expect(fs.lstatSync(blocked).isSymbolicLink()).toBe(true);
});
it("rollback workspace inspection rejects stopped seeds", () => {
    const root = fixture();
    prepareServiceMigrationWorkspace(root, "operation-1", "stopped");
    expect(() => inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toThrow();
});
it("rollback workspace inspection rejects non-exact private block records", () => {
    const root = fixture();
    prepareServiceMigrationWorkspace(root, "operation-1", "running");
    const blocked = path.join(root, ".control/migration-blocked.json");
    fs.writeFileSync(
        blocked,
        JSON.stringify({ schemaVersion: 1, operationId: "other-operation" }),
        { mode: 0o600 },
    );
    expect(() => inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toThrow();
    expect(() => blockServiceMigrationWorkspace(root, "operation-1")).toThrow();
    fs.unlinkSync(blocked);
    fs.writeFileSync(blocked, JSON.stringify({ schemaVersion: 1, operationId: "operation-1" }));
    fs.chmodSync(blocked, 0o644);
    expect(() => inspectServiceMigrationRollbackWorkspace(root, "operation-1")).toThrow();
    expect(() => blockServiceMigrationWorkspace(root, "operation-1")).toThrow();
});
