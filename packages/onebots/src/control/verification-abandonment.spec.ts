import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ControlVerificationAbandonment } from "@onebots/core/control";
import { ServiceOperationStorage } from "../service-operation-storage.js";
import { ControlVerificationService } from "./verification-service.js";
import { ControlVerificationStore, type VerificationRecord } from "./verification-store.js";

const directories: string[] = [];
const services: ControlVerificationService[] = [];
const owner = "a".repeat(64);
const other = "b".repeat(64);
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.allSettled(services.splice(0).map(service => service.close()));
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), "ob-verification-abandonment-"));
    directories.push(directory);
    const store = new ControlVerificationStore(directory);
    const command = {
        operationId: randomUUID(),
        challengeId: randomUUID(),
        expected: { gatewayInstanceId: randomUUID(), configVersion: "config-1" },
        action: "submit" as const,
        data: { code: "private-verification-answer" },
    };
    const record: VerificationRecord = {
        schemaVersion: 1,
        id: command.operationId,
        ownerHash: owner,
        requestDigest: store.digest(command),
        accountHash: store.accountHash("mock", "test-account"),
        challengeId: command.challengeId,
        ...command.expected,
        action: command.action,
        status: "running",
        startedAt: new Date().toISOString(),
    };
    const forward = vi.fn(async (): Promise<never> => {
        throw new Error("测试不允许调用网关");
    });
    function service(
        abandonWhileStopped = async (commit: () => ControlVerificationAbandonment) => commit(),
    ) {
        const value = new ControlVerificationService({
            directory,
            currentContext: () => command.expected,
            forward,
            abandonWhileStopped,
        });
        services.push(value);
        return value;
    }
    return { directory, store, command, record, forward, service };
}
function expectStatus(action: () => unknown, httpStatus: number) {
    let thrown: unknown;
    try {
        action();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toMatchObject({ httpStatus });
}

it("封存持久化且冷启动拒绝同编号创建和执行，不持久化验证码", async () => {
    const f = fixture();
    const receipt = f.store.abandon(owner, f.record.id);
    expect(receipt).toEqual({ id: f.record.id, abandonedAt: expect.any(String) });
    expect(f.store.abandon(owner, f.record.id)).toEqual(receipt);
    const recovered = new ControlVerificationStore(f.directory);
    expect(recovered.abandonment(owner, f.record.id)).toEqual(receipt);
    expectStatus(() => recovered.create(f.record), 409);
    expectStatus(() => recovered.assertNotAbandoned(f.record.id), 409);
    expect(recovered.health().available).toBe(true);
    await expect(f.service().execute(owner, f.command)).rejects.toMatchObject({ httpStatus: 409 });
    expect(f.forward).not.toHaveBeenCalled();
    expect(readdirSync(path.join(f.directory, "operations"))).toEqual([]);
    const disk = readFileSync(
        path.join(f.directory, "abandonments", `${f.record.id}.json`),
        "utf8",
    );
    expect(disk).not.toContain(f.command.data.code);
    expect(disk).not.toContain(f.command.challengeId);
    expect(JSON.stringify(receipt)).not.toContain(owner);
});

it.each(["running", "unknown", "succeeded"] as const)(
    "真实 %s 操作不得被任何设备封存为未受理编号",
    status => {
        const f = fixture();
        f.store.create(f.record);
        if (status !== "running")
            f.store.finish({ ...f.record, status, finishedAt: new Date().toISOString() });
        for (const actor of [owner, other]) {
            expectStatus(() => f.store.abandon(actor, f.record.id), 409);
            expectStatus(() => f.store.abandon(actor, f.record.id, true), 409);
        }
        expect(f.store.read(f.record.id).status).toBe(status);
        expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
    },
);

it("封存按设备隔离，本地恢复读取不改变原拥有者和时间", () => {
    const f = fixture();
    const receipt = f.store.abandon(owner, f.record.id);
    expectStatus(() => f.store.abandonment(other, f.record.id), 404);
    expectStatus(() => f.store.abandon(other, f.record.id), 404);
    const filename = path.join(f.directory, "abandonments", `${f.record.id}.json`);
    const before = readFileSync(filename, "utf8");
    expect(f.store.abandonment(other, f.record.id, true)).toEqual(receipt);
    expect(f.store.abandon(other, f.record.id, true)).toEqual(receipt);
    expect(readFileSync(filename, "utf8")).toBe(before);
    expect(f.store.abandonment(owner, f.record.id)).toEqual(receipt);
});

it("封存落盘失败封锁后续执行，不伪造成功回执", async () => {
    const f = fixture();
    const service = f.service();
    vi.spyOn(ServiceOperationStorage.prototype, "write").mockImplementation(() => {
        throw new Error("disk write failed");
    });
    await expect(service.abandon(owner, f.record.id, true)).rejects.toMatchObject({
        httpStatus: 503,
    });
    expect(service.health().available).toBe(false);
    await expect(service.execute(owner, f.command)).rejects.toMatchObject({ httpStatus: 503 });
    expect(f.forward).not.toHaveBeenCalled();
    expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
});

it.each(["corrupt", "missing-key"])("%s 的封存工作区冷启动后拒绝继续执行", failure => {
    const f = fixture();
    f.store.abandon(owner, f.record.id);
    if (failure === "corrupt")
        writeFileSync(path.join(f.directory, "abandonments", `${f.record.id}.json`), "{}");
    else rmSync(path.join(f.directory, "keys"), { recursive: true });
    const recovered = new ControlVerificationStore(f.directory);
    expect(recovered.health().available).toBe(false);
    expectStatus(() => recovered.assertNotAbandoned(f.record.id), 503);
    expectStatus(() => recovered.abandon(owner, randomUUID()), 503);
    if (failure === "missing-key") expect(readdirSync(path.join(f.directory, "keys"))).toEqual([]);
});

it.each(["revoked", "closed"])("等待停止事务期间 %s 必须在提交前重新拒绝", async state => {
    const f = fixture();
    let authorized = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const transaction = vi.fn(async (commit: () => ControlVerificationAbandonment) => {
        await gate;
        return commit();
    });
    const service = f.service(transaction);
    const pending = service.abandon(owner, f.record.id, true, () => authorized);
    const rejected = expect(pending).rejects.toMatchObject({ httpStatus: 403 });
    expect(transaction).toHaveBeenCalledOnce();
    if (state === "revoked") authorized = false;
    else await service.close();
    release();
    await rejected;
    expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
    expect(f.forward).not.toHaveBeenCalled();
});

it("同编号 execute 已进入待处理队列时不得封存，即使意图尚未落盘", async () => {
    const f = fixture();
    const transaction = vi.fn(async (commit: () => ControlVerificationAbandonment) => commit());
    const service = f.service(transaction);
    let authorized = true;
    const executing = service.execute(owner, f.command, () => authorized);
    const executionRejected = expect(executing).rejects.toThrow();
    await expect(service.abandon(owner, f.record.id, true)).rejects.toMatchObject({
        httpStatus: 409,
    });
    authorized = false;
    await executionRejected;
    expect(transaction).not.toHaveBeenCalled();
    expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
});

it("封存必须显式确认且停止事务是必经门禁；确认后迟到请求不触发网关", async () => {
    const f = fixture();
    const transaction = vi.fn(async (commit: () => ControlVerificationAbandonment) => commit());
    const service = f.service(transaction);
    await expect(service.abandon(owner, f.record.id, false)).rejects.toMatchObject({
        httpStatus: 400,
    });
    expect(transaction).not.toHaveBeenCalled();
    const receipt = await service.abandon(owner, f.record.id, true);
    expect(transaction).toHaveBeenCalledOnce();
    expect(service.abandonment(owner, f.record.id)).toEqual(receipt);
    await expect(service.execute(owner, f.command)).rejects.toMatchObject({ httpStatus: 409 });
    expect(f.forward).not.toHaveBeenCalled();
    expect(await service.abandon(owner, f.record.id, true)).toEqual(receipt);
    expect(transaction).toHaveBeenCalledOnce();
});

it("停止事务等待期间产生真实意图，提交时仍拒绝封存", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const service = f.service(async commit => {
        await gate;
        return commit();
    });
    const pending = service.abandon(owner, f.record.id, true);
    const rejected = expect(pending).rejects.toMatchObject({ httpStatus: 409 });
    f.store.create(f.record);
    release();
    await rejected;
    expect(f.store.read(f.record.id).status).toBe("running");
    expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
    expect(f.forward).not.toHaveBeenCalled();
});

it("没有可证明已停止的事务能力时不创建封存", async () => {
    const f = fixture();
    const service = new ControlVerificationService({
        directory: f.directory,
        currentContext: () => undefined,
        forward: f.forward,
    });
    services.push(service);
    await expect(service.abandon(owner, f.record.id, true)).rejects.toMatchObject({
        httpStatus: 503,
    });
    expect(readdirSync(path.join(f.directory, "abandonments"))).toEqual([]);
    expect(f.forward).not.toHaveBeenCalled();
});
