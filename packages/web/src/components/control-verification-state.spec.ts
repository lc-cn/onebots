import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    ControlVerificationOperation,
    ControlVerificationSnapshot,
} from "@onebots/core/control";
import {
    VerificationController,
    verificationView,
    safeVerificationUrl,
    safeVerificationImage,
} from "./control-verification-state";
const gateway = "e01530c4-aef7-4a91-8819-e7b740711253";
const challengeId = "eead5902-d5c8-4765-8c07-40a39242f117";
const snapshot: ControlVerificationSnapshot = {
    gatewayInstanceId: gateway,
    configVersion: "v1",
    challenges: [
        {
            id: challengeId,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60000,
            request: {
                platform: "mock",
                account_id: "1",
                type: "code",
                hint: "验证",
                options: { blocks: [{ type: "input", key: "code" }] },
            },
        },
    ],
};
const session = { id: "a".repeat(32), issuedAt: 1, expiresAt: 2, current: true };
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    const values = new Map<string, string>();
    const storage = {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            values.set(key, value);
        }),
    };
    const verification = {
        pending: vi.fn().mockResolvedValue(snapshot),
        execute: vi.fn(),
        reconcile: vi.fn(),
        acknowledge: vi.fn(),
        abandon: vi.fn(),
        abandonment: vi.fn().mockRejectedValue(new Error("missing")),
        operation: vi.fn(),
    };
    const sessions = vi.fn().mockResolvedValue({ sessions: [session] });
    const view = verificationView();
    const controller = new VerificationController({ verification, sessions }, view, storage);
    controller.setGateway(gateway);
    return { controller, view, verification, storage, values, sessions };
}
describe("control verification browser workflow", () => {
    it("persists only identifiers before dispatch and never resends an uncertain operation", async () => {
        const f = fixture();
        await f.controller.initialize();
        await f.controller.refresh();
        f.view.answers[challengeId].code = "secret-answer";
        f.verification.execute.mockImplementation(async command => {
            expect([...f.values.values()][0]).toContain(command.operationId);
            expect(JSON.stringify([...f.values])).not.toContain("secret-answer");
            expect(JSON.stringify([...f.values])).not.toContain("private-device-token");
            throw new Error("lost");
        });
        await f.controller.submit(challengeId, "submit");
        expect(f.controller.uncertain).toBe(true);
        expect(f.view.answers).toEqual({});
        await f.controller.refresh();
        await f.controller.submit(challengeId, "submit");
        expect(f.verification.execute).toHaveBeenCalledTimes(1);
        f.controller.setGateway(undefined);
        await f.controller.query(f.view.ids[0]);
        expect(f.verification.operation).toHaveBeenCalledWith(f.view.ids[0]);
    });
    it("does not send when durable browser storage fails", async () => {
        const f = fixture();
        await f.controller.initialize();
        await f.controller.refresh();
        f.view.answers[challengeId].code = "1234";
        f.storage.setItem.mockImplementation(() => {
            throw new Error("quota");
        });
        await f.controller.submit(challengeId, "submit");
        expect(f.verification.execute).not.toHaveBeenCalled();
    });
    it("ignores late snapshots and never overlaps requests", async () => {
        const f = fixture();
        let resolve!: (result: ControlVerificationSnapshot) => void;
        f.verification.pending.mockImplementation(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const task = f.controller.refresh();
        await f.controller.refresh();
        f.controller.setGateway("new");
        resolve(snapshot);
        await task;
        expect(f.verification.pending).toHaveBeenCalledTimes(1);
        expect(f.view.snapshot).toBeUndefined();
    });
    it("restores unresolved IDs per device and leaves unknown receipts locked", async () => {
        const f = fixture();
        await f.controller.initialize();
        await f.controller.refresh();
        f.view.answers[challengeId].code = "1234";
        f.verification.execute.mockRejectedValue(new Error("lost"));
        await f.controller.submit(challengeId, "submit");
        const restored = new VerificationController(
            { verification: f.verification, sessions: f.sessions },
            verificationView(),
            f.storage,
        );
        await restored.initialize();
        expect(restored.view.ids).toEqual(f.view.ids);
        expect(restored.uncertain).toBe(true);
        const receipt: ControlVerificationOperation = {
            id: f.view.ids[0],
            challengeId,
            gatewayInstanceId: gateway,
            configVersion: "v1",
            action: "submit",
            status: "unknown",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
        };
        f.verification.operation.mockResolvedValue(receipt);
        await restored.query(receipt.id);
        expect(restored.uncertain).toBe(true);
        const other = new VerificationController(
            { verification: f.verification, sessions: f.sessions },
            verificationView(),
            f.storage,
        );
        f.sessions.mockResolvedValue({ sessions: [{ ...session, id: "b".repeat(32) }] });
        await other.initialize();
        expect(other.view.ids).toEqual([]);
    });
    it("rejects missing inputs before persisting an operation", async () => {
        const f = fixture();
        await f.controller.initialize();
        await f.controller.refresh();
        await f.controller.submit(challengeId, "submit");
        expect(f.view.ids).toEqual([]);
        expect(f.storage.setItem).not.toHaveBeenCalled();
        expect(f.verification.execute).not.toHaveBeenCalled();
        expect(f.controller.uncertain).toBe(false);
    });
    it("works on HTTP without subtle or randomUUID using the current device scope", async () => {
        const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
        vi.stubGlobal("crypto", { getRandomValues });
        const f = fixture();
        await f.controller.initialize();
        expect(f.view.ready).toBe(true);
        await f.controller.refresh();
        f.view.answers[challengeId].code = "1234";
        f.verification.execute.mockRejectedValue(new Error("lost"));
        await f.controller.submit(challengeId, "submit");
        expect(f.view.ids[0]).toMatch(
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        );
        expect([...f.values.keys()]).toEqual([`onebots.verification.${session.id}`]);
    });
    it("rejects ambiguous device scope", async () => {
        const f = fixture();
        f.sessions.mockResolvedValue({ sessions: [session, { ...session, id: "b".repeat(32) }] });
        await f.controller.initialize();
        expect(f.view.ready).toBe(false);
        expect(f.storage.getItem).not.toHaveBeenCalled();
    });
    it("rejects active-content images and credential-bearing links", () => {
        expect(safeVerificationUrl("javascript:alert(1)")).toBeUndefined();
        expect(safeVerificationUrl("https://user:password@example.com")).toBeUndefined();
        expect(safeVerificationUrl("https://example.com")).toBe("https://example.com/");
        expect(safeVerificationImage("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
        expect(safeVerificationImage("https://example.com/a.png")).toBeUndefined();
        expect(safeVerificationImage("data:image/png;base64,YQ==")).toBeDefined();
    });
});

it("explicit reconciliation unlocks only confirmed evidence without re-executing", async () => {
    const f = fixture();
    const operation: ControlVerificationOperation = {
        id: challengeId,
        challengeId,
        gatewayInstanceId: gateway,
        configVersion: "v1",
        action: "submit",
        status: "unknown",
        startedAt: "2026-09-09T00:00:00.000Z",
        finishedAt: "2026-09-09T00:00:01.000Z",
    };
    f.view.ids = [challengeId];
    f.view.receipts[challengeId] = operation;
    expect(f.controller.uncertain).toBe(true);
    f.verification.reconcile.mockRejectedValueOnce(new Error("lost"));
    await f.controller.reconcile(challengeId);
    expect(f.controller.uncertain).toBe(true);
    f.verification.reconcile.mockResolvedValueOnce(operation);
    await f.controller.reconcile(challengeId);
    expect(f.controller.uncertain).toBe(true);
    f.verification.reconcile.mockResolvedValueOnce({
        ...operation,
        resolution: { outcome: "succeeded", confirmedAt: "2026-09-09T00:00:02.000Z" },
    });
    await f.controller.reconcile(challengeId);
    expect(f.controller.uncertain).toBe(false);
    expect(f.view.receipts[challengeId].status).toBe("unknown");
    await f.controller.reconcile(challengeId);
    expect(f.verification.reconcile).toHaveBeenCalledTimes(3);
    expect(f.verification.reconcile).toHaveBeenCalledWith(challengeId);
    expect(f.verification.execute).not.toHaveBeenCalled();
    expect(f.verification.pending).not.toHaveBeenCalled();
});

it("reconciliation ignores late gateway responses and prevents duplicate clicks", async () => {
    const f = fixture();
    const operation: ControlVerificationOperation = {
        id: challengeId,
        challengeId,
        gatewayInstanceId: gateway,
        configVersion: "v1",
        action: "submit",
        status: "unknown",
        startedAt: "2026-09-09T00:00:00.000Z",
        finishedAt: "2026-09-09T00:00:01.000Z",
    };
    f.view.ids = [challengeId];
    f.view.receipts[challengeId] = operation;
    let finish!: (receipt: ControlVerificationOperation) => void;
    f.verification.reconcile.mockReturnValue(
        new Promise<ControlVerificationOperation>(resolve => {
            finish = resolve;
        }),
    );
    const pending = f.controller.reconcile(challengeId);
    await f.controller.reconcile(challengeId);
    expect(f.verification.reconcile).toHaveBeenCalledTimes(1);
    f.controller.setGateway(undefined);
    finish({
        ...operation,
        resolution: { outcome: "rejected", confirmedAt: "2026-09-09T00:00:02.000Z" },
    });
    await pending;
    expect(f.controller.uncertain).toBe(true);
    expect(f.view.receipts[challengeId]).toEqual(operation);
    expect(f.view.busy).toBe(false);
    f.verification.operation.mockResolvedValue({
        ...operation,
        resolution: { outcome: "rejected", confirmedAt: "2026-09-09T00:00:02.000Z" },
    });
    await f.controller.query(challengeId);
    expect(f.controller.uncertain).toBe(false);
    expect(f.verification.execute).not.toHaveBeenCalled();
});

it("requires stopped gateway and explicit risk acceptance; lost confirmation stays uncertain until original query", async () => {
    const f = fixture();
    const operation: ControlVerificationOperation = {
        id: challengeId,
        challengeId,
        gatewayInstanceId: gateway,
        configVersion: "v1",
        action: "submit",
        status: "unknown",
        startedAt: "2026-09-09T00:00:00.000Z",
        finishedAt: "2026-09-09T00:00:01.000Z",
    };
    f.view.ids = [challengeId];
    f.view.receipts[challengeId] = operation;
    await f.controller.acknowledge(challengeId, true);
    f.controller.setGateway(undefined);
    await f.controller.acknowledge(challengeId, false);
    expect(f.verification.acknowledge).not.toHaveBeenCalled();
    f.verification.acknowledge.mockRejectedValue(new Error("lost"));
    await f.controller.acknowledge(challengeId, true);
    expect(f.verification.acknowledge).toHaveBeenCalledExactlyOnceWith(challengeId, true);
    expect(f.controller.uncertain).toBe(true);
    expect(f.view.error).toContain("查询原操作回执");
    f.verification.operation.mockResolvedValue({
        ...operation,
        acknowledgement: { acceptedAt: "2026-09-09T00:00:02.000Z" },
    });
    await f.controller.query(challengeId);
    expect(f.controller.uncertain).toBe(false);
    expect(f.view.receipts[challengeId].status).toBe("unknown");
    await f.controller.acknowledge(challengeId, true);
    await f.controller.reconcile(challengeId);
    expect(f.verification.acknowledge).toHaveBeenCalledTimes(1);
    expect(f.verification.reconcile).not.toHaveBeenCalled();
    expect(f.verification.execute).not.toHaveBeenCalled();
});

it("封存需停机和显式确认，保留编号并在刷新后只读恢复", async () => {
    const f = fixture();
    f.values.set(`onebots.verification.${session.id}`, JSON.stringify([challengeId]));
    await f.controller.initialize();
    const sealed = { id: challengeId, abandonedAt: new Date(2).toISOString() };
    f.verification.operation.mockRejectedValue(new Error("missing or unauthorized"));
    await f.controller.abandon(challengeId, true);
    f.controller.setGateway(undefined);
    await f.controller.abandon(challengeId, false);
    expect(f.verification.abandon).not.toHaveBeenCalled();
    await f.controller.query(challengeId);
    expect(f.controller.uncertain).toBe(true);
    expect(f.verification.abandonment).toHaveBeenCalledExactlyOnceWith(challengeId);
    f.verification.abandon.mockRejectedValueOnce(new Error("lost"));
    await f.controller.abandon(challengeId, true);
    expect(f.controller.uncertain).toBe(true);
    expect(f.verification.abandon).toHaveBeenCalledExactlyOnceWith(challengeId, true);
    f.verification.abandonment.mockResolvedValue(sealed);
    await f.controller.query(challengeId);
    expect(f.controller.uncertain).toBe(false);
    expect(f.view.ids).toEqual([challengeId]);
    expect(f.view.receipts[challengeId]).toBeUndefined();
    const restored = new VerificationController(
        { verification: f.verification, sessions: f.sessions },
        verificationView(),
        f.storage,
    );
    await restored.initialize();
    expect(restored.uncertain).toBe(true);
    await restored.query(challengeId);
    expect(restored.uncertain).toBe(false);
    expect(restored.view.abandonments[challengeId]).toEqual(sealed);
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.verification.execute).not.toHaveBeenCalled();
});

it("封存不会替代已有未知回执；丢弃迟到结果且禁止重叠点击", async () => {
    const f = fixture();
    f.controller.setGateway(undefined);
    f.view.ids = [challengeId];
    let finish!: (value: { id: string; abandonedAt: string }) => void;
    f.verification.abandon.mockReturnValue(
        new Promise(resolve => {
            finish = resolve;
        }),
    );
    const pending = f.controller.abandon(challengeId, true);
    await f.controller.abandon(challengeId, true);
    expect(f.verification.abandon).toHaveBeenCalledOnce();
    f.controller.setGateway(gateway);
    finish({ id: challengeId, abandonedAt: new Date(2).toISOString() });
    await pending;
    expect(f.controller.uncertain).toBe(true);
    expect(f.view.abandonments).toEqual({});
    f.controller.setGateway(undefined);
    f.view.receipts[challengeId] = {
        id: challengeId,
        challengeId,
        gatewayInstanceId: gateway,
        configVersion: "v1",
        action: "submit",
        status: "unknown",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
    };
    await f.controller.abandon(challengeId, true);
    expect(f.verification.abandon).toHaveBeenCalledOnce();
    expect(f.controller.uncertain).toBe(true);
});
