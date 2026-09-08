import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectManagerServiceStatus } from "./manager-service-status.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { getServiceFiles } from "./service-files.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState } from "./service-platform.js";
import type { MigrationManagerState } from "./service-migration-manager.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-manager-status-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        uid: 501,
        homedir: root,
        env: {},
        exec: vi.fn(() => {
            throw new Error("no commands expected");
        }),
        spawn: vi.fn(async () => {
            throw new Error("no spawn");
        }),
    };
    const files = getServiceFiles("user", host);
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: path.join(root, "secret-workspace"),
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        workingDirectory: root,
        host: "127.0.0.1",
        port: 6727,
    };
    fs.mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(files.definition), { recursive: true });
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    fs.writeFileSync(
        files.definition,
        renderInstalledManagerService(spec, host.platform, files.stateDir),
    );
    const os: ServicePlatformState = {
        state: "running",
        running: true,
        enabled: true,
        loaded: true,
        definitionPath: files.definition,
        processId: 321,
        identity: "instance-a",
        quiescent: false,
    };
    const manager: MigrationManagerState = {
        schemaVersion: 1,
        manager: { id: randomUUID(), pid: 321, version: "1.0.0" },
        gateway: { actual: "failed", desired: "running", recoveryRequired: false },
        serviceMigration: { pending: false, recoveryRequired: false },
        knownConfigurationFailure: true,
    };
    const inspect = vi.fn(async () => ({ ...os })),
        ipc = vi.fn(async () => manager);
    return {
        root,
        host,
        files,
        spec,
        os,
        manager,
        inspect,
        ipc,
        dependencies: { platform: () => ({ inspect }), inspectManager: ipc },
    };
}
describe("manager service readonly status", () => {
    it("正常running IPC不掩盖未完成系统操作，状态查询不coldmark或写盘", async () => {
        const f = fixture();
        f.manager.gateway = { desired: "running", actual: "running", recoveryRequired: false };
        f.manager.knownConfigurationFailure = false;
        const journal = new FileManagerServiceJournal(
            path.join(f.files.stateDir, "manager-operations"),
        );
        journal.prepare({ id: "unfinished", action: "start", desiredEnabled: true, spec: f.spec });
        const file = path.join(f.files.stateDir, "manager-operations/unfinished.json");
        const before = fs.readFileSync(file);
        const write = vi.spyOn(fs, "writeFileSync"),
            mkdir = vi.spyOn(fs, "mkdirSync"),
            chmod = vi.spyOn(fs, "chmodSync");
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.serviceRecoveryRequired).toBe(true);
        expect(result.manager.ipc).toBe("available");
        expect(result.gateway.recoveryRequired).toBe(false);
        expect(fs.readFileSync(file)).toEqual(before);
        expect(write).not.toHaveBeenCalled();
        expect(mkdir).not.toHaveBeenCalled();
        expect(chmod).not.toHaveBeenCalled();
    });
    it("损坏系统记录与IPC迁移门禁分别进入独立恢复摘要", async () => {
        const f = fixture();
        const directory = path.join(f.files.stateDir, "manager-operations");
        fs.mkdirSync(directory, { mode: 0o700 });
        fs.writeFileSync(path.join(directory, "broken.json"), '{"private-secret":', {
            mode: 0o600,
        });
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.serviceRecoveryRequired).toBe(true);
        expect(JSON.stringify(result)).not.toContain("private-secret");
        fs.unlinkSync(path.join(directory, "broken.json"));
        f.manager.serviceMigration.pending = true;
        expect(
            (await inspectManagerServiceStatus("user", f.host, f.dependencies))
                .serviceRecoveryRequired,
        ).toBe(true);
    });
    it("坏配置只影响网关，manager保持running；不读取业务文件或输出spec", async () => {
        const f = fixture();
        fs.mkdirSync(f.spec.workspace);
        fs.writeFileSync(path.join(f.spec.workspace, "config.yaml"), "secret: [private-key");
        const before = fs.readdirSync(f.files.stateDir);
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.manager).toMatchObject({ state: "running", ipc: "available", pid: 321 });
        expect(result.gateway).toEqual({
            actual: "failed",
            desired: "running",
            recoveryRequired: false,
            knownConfigurationFailure: true,
        });
        expect(JSON.stringify(result)).not.toMatch(/private-key|secret-workspace|nodePath|binPath/);
        expect(fs.readdirSync(f.files.stateDir)).toEqual(before);
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
        expect(f.inspect).toHaveBeenCalledTimes(2);
    });
    it.each(["missing", "legacy", "invalid"] as const)(
        "%s元数据不会落回旧业务服务或调用OS",
        async kind => {
            const f = fixture();
            if (kind === "missing") fs.unlinkSync(f.files.metadata);
            else
                fs.writeFileSync(
                    f.files.metadata,
                    kind === "invalid"
                        ? "malformed-secret"
                        : JSON.stringify({
                              scope: "user",
                              configPath: "/secret/config.yaml",
                              adapters: [],
                              protocols: [],
                              nodePath: "/node",
                              binPath: "/bin",
                              workingDirectory: "/work",
                          }),
                );
            const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
            expect(result.installation).toBe(kind);
            expect(f.inspect).not.toHaveBeenCalled();
            expect(f.ipc).not.toHaveBeenCalled();
            expect(JSON.stringify(result)).not.toContain("secret");
        },
    );
    it("OS stopped不把旧磁盘网关状态当实时状态", async () => {
        const f = fixture();
        Object.assign(f.os, { state: "stopped", running: false, processId: null });
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.manager.state).toBe("stopped");
        expect(result.gateway.actual).toBe("unknown");
        expect(result.gateway.desired).toBe("unknown");
        expect(f.ipc).not.toHaveBeenCalled();
    });
    it("IPC断开不改写OS running，异常原文不输出", async () => {
        const f = fixture();
        f.ipc.mockRejectedValue(new Error("synthetic-secret"));
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.manager).toMatchObject({ state: "running", ipc: "unavailable" });
        expect(result.diagnostic).toBe("ipc-unavailable");
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    });
    it("PID不符或前后实例变化不能认领网关", async () => {
        const f = fixture();
        f.manager.manager.pid = 999;
        expect((await inspectManagerServiceStatus("user", f.host, f.dependencies)).diagnostic).toBe(
            "identity-mismatch",
        );
        f.inspect
            .mockResolvedValueOnce({ ...f.os })
            .mockResolvedValueOnce({ ...f.os, identity: "new" });
        const result = await inspectManagerServiceStatus("user", f.host, f.dependencies);
        expect(result.manager.state).toBe("unknown");
        expect(result.diagnostic).toBe("baseline-changed");
    });
    it("定义不匹配拒绝无关label，查询期间元数据变化拒绝拼接证据", async () => {
        const f = fixture();
        fs.appendFileSync(f.files.definition, "changed");
        expect((await inspectManagerServiceStatus("user", f.host, f.dependencies)).diagnostic).toBe(
            "definition-mismatch",
        );
        expect(f.inspect).not.toHaveBeenCalled();
        fs.writeFileSync(
            f.files.definition,
            renderInstalledManagerService(f.spec, f.host.platform, f.files.stateDir),
        );
        f.ipc.mockImplementation(async () => {
            fs.writeFileSync(f.files.metadata, "{}");
            return f.manager;
        });
        expect((await inspectManagerServiceStatus("user", f.host, f.dependencies)).diagnostic).toBe(
            "baseline-changed",
        );
    });
});
