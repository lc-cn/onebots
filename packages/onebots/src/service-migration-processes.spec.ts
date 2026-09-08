import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    claimServiceProcessOwnership,
    closeServiceProcessOwnership,
    prepareServiceProcessOwnershipSeed,
    verifyServiceMigrationProcesses,
    verifyServiceMigrationProcessesWhileLocked,
} from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
} from "./configuration/configuration-verify-ownership.js";
import {
    allocateDownloadCredentials,
    updateDownloadOwner,
} from "./installation/generation-download-state.js";
import { handleServiceMigrationRequest } from "./control/service-migration-api.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-process-proof-")));
    roots.push(workspace);
    const release = acquireControlWorkspace(workspace);
    const control = path.join(workspace, ".control");
    const state = {
        schemaVersion: 1,
        desired: "stopped",
        actual: "stopped",
        recoveryRequired: false,
        operations: [],
    };
    const save = (value: unknown = state) =>
        fs.writeFileSync(path.join(control, "gateway.json"), JSON.stringify(value), {
            mode: 0o600,
        });
    save();
    fs.writeFileSync(
        path.join(control, "migration-pending.json"),
        JSON.stringify({ schemaVersion: 1, operationId: "test-seed", desired: "stopped" }),
        { mode: 0o600 },
    );
    prepareServiceProcessOwnershipSeed(workspace);
    release();
    return { workspace, control, state, save };
}
async function deadPid() {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(child, "exit");
    expect(() => process.kill(child.pid!, 0)).toThrow();
    return child.pid!;
}
describe("管理服务迁移进程证明", () => {
    it("显式seed可验证；缺失、旧版本、损坏凭据绝不被补写", async () => {
        const f = fixture();
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
        const receipt = path.join(f.control, "process-ownership.json");
        fs.unlinkSync(receipt);
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        expect(await claimServiceProcessOwnership(f.workspace, randomUUID(), false)).toBe(false);
        expect(fs.existsSync(receipt)).toBe(false);
        fs.writeFileSync(receipt, '{"schemaVersion":99}', { mode: 0o600 });
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
    });
    it("seed拒绝夹入其他管理状态，已有receipt绝不覆盖", () => {
        const f = fixture(),
            receipt = path.join(f.control, "process-ownership.json");
        const original = fs.readFileSync(receipt);
        expect(() => prepareServiceProcessOwnershipSeed(f.workspace)).toThrow();
        expect(fs.readFileSync(receipt)).toEqual(original);
        fs.unlinkSync(receipt);
        fs.writeFileSync(path.join(f.control, "auth.json"), "{}", { mode: 0o600 });
        expect(() => prepareServiceProcessOwnershipSeed(f.workspace)).toThrow();
        expect(fs.existsSync(receipt)).toBe(false);
    });
    it("拿不到工作区锁时不检查或改写持有者记录", async () => {
        const f = fixture(),
            release = acquireControlWorkspace(f.workspace);
        try {
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        } finally {
            release();
        }
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
    });
    it("新host声明覆盖协议，存活manager拒绝迁移；关闭后可同进程重开", async () => {
        const f = fixture(),
            id = randomUUID();
        const release = acquireControlWorkspace(f.workspace);
        try {
            expect(await claimServiceProcessOwnership(f.workspace, id, false)).toBe(true);
            await closeServiceProcessOwnership(f.workspace, id);
        } finally {
            release();
        }
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        const again = acquireControlWorkspace(f.workspace);
        try {
            expect(await claimServiceProcessOwnership(f.workspace, randomUUID(), false)).toBe(true);
        } finally {
            again();
        }
    });
    it("冷态仅manager与网关PID/PGID全部消失才可通过", async () => {
        const f = fixture(),
            pid = await deadPid();
        fs.writeFileSync(
            path.join(f.control, "process-ownership.json"),
            JSON.stringify({
                schemaVersion: 1,
                hostname: os.hostname(),
                phase: "active",
                managerId: randomUUID(),
                pid,
            }),
            { mode: 0o600 },
        );
        f.save({ ...f.state, actual: "running", instance: { id: randomUUID(), pid } });
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
        const probe = vi.spyOn(process, "kill");
        probe.mockImplementation((target, signal) => {
            expect(signal).toBe(0);
            if (target === -pid) return true;
            throw Object.assign(new Error(), { code: "ESRCH" });
        });
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
    });
    it.each(["starting", "stopping", "unknown"])("不凭缺失PID放行 %s 网关", async actual => {
        const f = fixture();
        f.save({ ...f.state, actual, recoveryRequired: true });
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
    });
    it("逐一读取验证owner；spawning永远阻断，历史PID只探测不清理", async () => {
        const f = fixture(),
            pid = await deadPid();
        for (const relative of [
            "generation-verifications",
            "configuration/verification-workers",
            "configuration/schema-workers",
        ]) {
            const { directory, owner } = allocateConfigurationVerification(
                path.join(f.control, relative),
            );
            owner.parentPid = pid;
            writeConfigurationVerificationOwner(directory, owner);
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
            owner.phase = "spawning";
            writeConfigurationVerificationOwner(directory, owner);
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
            expect(fs.existsSync(path.join(directory, "owner.json"))).toBe(true);
            owner.phase = "running";
            owner.workerPid = process.pid;
            writeConfigurationVerificationOwner(directory, owner);
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
            owner.workerPid = pid;
            writeConfigurationVerificationOwner(directory, owner);
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
        }
    });
    it("下载worker与downloader都检查，未知权限不能解释为退出", async () => {
        const f = fixture(),
            pid = await deadPid();
        const { directory, owner } = await allocateDownloadCredentials(
            path.join(f.control, "downloads"),
        );
        await updateDownloadOwner(directory, owner, {
            phase: "downloading",
            workerPid: pid,
            downloaderPid: pid,
        });
        const file = path.join(directory, "owner.json");
        fs.writeFileSync(file, JSON.stringify({ ...owner, parentPid: pid }));
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
        vi.spyOn(process, "kill").mockImplementation(() => {
            throw Object.assign(new Error(), { code: "EPERM" });
        });
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        expect(fs.existsSync(file)).toBe(true);
    });
    it("拒绝跨主机凭据、符号链接及非私有文件", async () => {
        const f = fixture(),
            receipt = path.join(f.control, "process-ownership.json");
        const original = fs.readFileSync(receipt);
        fs.writeFileSync(
            receipt,
            JSON.stringify({ ...JSON.parse(original.toString()), hostname: "foreign" }),
        );
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        fs.writeFileSync(receipt, original);
        fs.chmodSync(receipt, 0o644);
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
        fs.chmodSync(receipt, 0o600);
        fs.symlinkSync(f.workspace, path.join(f.control, "generation-verifications"));
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
    });
    it("ownership维护gate包括release但不禁GET", async () => {
        const input = {
            workspace: "/unused",
            pathname: "/api/control/service-migration/release",
            method: "POST",
            local: true,
            ownershipAvailable: false,
            body: async () => {
                throw new Error("must not read");
            },
        };
        expect(await handleServiceMigrationRequest(input)).toMatchObject({ status: 423 });
        expect(
            await handleServiceMigrationRequest({
                ...input,
                pathname: "/api/control/status",
                method: "GET",
            }),
        ).toBeNull();
    });
});

describe("caller-owned workspace lock process verification", () => {
    it("verifies inside the caller's real lock without releasing it while the wrapper remains exclusive", async () => {
        const f = fixture();
        const unlock = acquireControlWorkspace(f.workspace);
        try {
            expect(await verifyServiceMigrationProcessesWhileLocked(f.workspace)).toBe(true);
            expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(false);
            expect(() => acquireControlWorkspace(f.workspace)).toThrow();
            expect(await verifyServiceMigrationProcessesWhileLocked(f.workspace)).toBe(true);
            expect(() => acquireControlWorkspace(f.workspace)).toThrow();
        } finally {
            unlock();
        }
        expect(await verifyServiceMigrationProcesses(f.workspace)).toBe(true);
    });
    it("does not relax damaged owner or gateway uncertainty when caller already holds the lock", async () => {
        const f = fixture();
        const unlock = acquireControlWorkspace(f.workspace);
        try {
            f.save({ ...f.state, recoveryRequired: true });
            expect(await verifyServiceMigrationProcessesWhileLocked(f.workspace)).toBe(false);
            f.save();
            fs.writeFileSync(path.join(f.control, "process-ownership.json"), "synthetic-secret");
            expect(await verifyServiceMigrationProcessesWhileLocked(f.workspace)).toBe(false);
            expect(() => acquireControlWorkspace(f.workspace)).toThrow();
        } finally {
            unlock();
        }
    });
    it("still rejects an active manager and never alters its ownership record", async () => {
        const f = fixture();
        const unlock = acquireControlWorkspace(f.workspace);
        try {
            expect(await claimServiceProcessOwnership(f.workspace, randomUUID(), false)).toBe(true);
            const file = path.join(f.control, "process-ownership.json"),
                before = fs.readFileSync(file);
            expect(await verifyServiceMigrationProcessesWhileLocked(f.workspace)).toBe(false);
            expect(fs.readFileSync(file)).toEqual(before);
        } finally {
            unlock();
        }
    });
});
