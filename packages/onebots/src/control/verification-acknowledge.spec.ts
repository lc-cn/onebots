import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
    ControlVerificationService,
    type ControlVerificationServiceOptions,
} from "./verification-service.js";
import { ControlVerificationStore } from "./verification-store.js";
import type { VerificationRecord } from "./verification-record.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), "ob-acknowledge-"));
    roots.push(directory);
    const store = new ControlVerificationStore(directory);
    const record: VerificationRecord = {
        schemaVersion: 1,
        id: randomUUID(),
        ownerHash: "a".repeat(64),
        requestDigest: "b".repeat(64),
        accountHash: "c".repeat(64),
        challengeId: randomUUID(),
        gatewayInstanceId: randomUUID(),
        configVersion: "config",
        action: "submit",
        status: "running",
        startedAt: new Date().toISOString(),
    };
    store.create(record);
    store.finish({ ...record, status: "unknown", finishedAt: new Date().toISOString() });
    const forward = vi.fn<ControlVerificationServiceOptions["forward"]>();
    const stopped = vi.fn<
        NonNullable<ControlVerificationServiceOptions["acknowledgeWhileStopped"]>
    >(async commit => commit());
    const service = new ControlVerificationService({
        directory,
        currentContext: () => undefined,
        forward,
        acknowledgeWhileStopped: stopped,
    });
    return { directory, record, service, forward, stopped };
}
it("只有原设备或本机恢复身份能明确接受；原操作重复查询不派发SDK", async () => {
    const f = fixture();
    await expect(
        f.service.acknowledge(f.record.ownerHash, f.record.id, false),
    ).rejects.toMatchObject({ httpStatus: 400 });
    await expect(f.service.acknowledge("d".repeat(64), f.record.id, true)).rejects.toMatchObject({
        httpStatus: 404,
    });
    expect(f.stopped).not.toHaveBeenCalled();
    const result = await f.service.acknowledge("d".repeat(64), f.record.id, true, () => true, true);
    expect(result).toMatchObject({
        status: "unknown",
        acknowledgement: { acceptedAt: expect.any(String) },
    });
    expect(result).not.toHaveProperty("acknowledgedByHash");
    expect(await f.service.acknowledge(f.record.ownerHash, f.record.id, true)).toEqual(result);
    expect(await f.service.reconcile(f.record.ownerHash, f.record.id)).toEqual(result);
    expect(f.stopped).toHaveBeenCalledTimes(1);
    expect(f.forward).not.toHaveBeenCalled();
    await f.service.close();
});
it("生命周期证明拒绝时不落接受记录", async () => {
    const f = fixture();
    f.stopped.mockRejectedValue(new Error("网关未停止"));
    await expect(f.service.acknowledge(f.record.ownerHash, f.record.id, true)).rejects.toThrow();
    expect(f.service.operation(f.record.ownerHash, f.record.id)).not.toHaveProperty(
        "acknowledgement",
    );
    expect(f.forward).not.toHaveBeenCalled();
    await f.service.close();
});
it.each(["revoked", "closed"])("排队之后再次检查 %s，不允许晚到接受写盘", async reason => {
    const f = fixture();
    let authorized = true;
    f.stopped.mockImplementation(async commit => {
        if (reason === "revoked") authorized = false;
        else await f.service.close();
        return commit();
    });
    await expect(
        f.service.acknowledge(f.record.ownerHash, f.record.id, true, () => authorized),
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.service.operation(f.record.ownerHash, f.record.id)).not.toHaveProperty(
        "acknowledgement",
    );
    await f.service.close();
});
it("已对账的结果不能被人工接受覆盖，未提供停止证明也不能接受", async () => {
    const f = fixture();
    const store = new ControlVerificationStore(f.directory);
    const resolved = store.resolve(store.read(f.record.id), "succeeded");
    await expect(
        f.service.acknowledge(f.record.ownerHash, f.record.id, true),
    ).rejects.toMatchObject({ httpStatus: 409 });
    expect(f.service.operation(f.record.ownerHash, f.record.id).resolution).toEqual(
        resolved.resolution,
    );
    const g = fixture();
    const unbound = new ControlVerificationService({
        directory: g.directory,
        currentContext: () => undefined,
        forward: g.forward,
    });
    await expect(unbound.acknowledge(g.record.ownerHash, g.record.id, true)).rejects.toMatchObject({
        httpStatus: 503,
    });
    await Promise.all([f.service.close(), g.service.close(), unbound.close()]);
});
