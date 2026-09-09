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
