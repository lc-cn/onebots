import fs from "node:fs";
import type { ControlSendRequest } from "@onebots/core/control";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlSendService } from "./send-service.js";
import { ControlSendStore } from "./send-store.js";
import { parseSendRequest, sendDigest } from "./send-contracts.js";
import { ServiceOperationStorage } from "../service-operation-storage.js";
import { GatewayRequestError } from "./gateway-request-client.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const owner = "a".repeat(64);
function fixture(onOperation = vi.fn()) {
    const directory = fs.mkdtempSync("/tmp/control-send-");
    roots.push(directory);
    const context = { gatewayInstanceId: randomUUID(), configVersion: "b".repeat(64) };
    const forward = vi.fn(async (_request: ControlSendRequest) => ({ messageId: "platform-id" }));
    const options = { directory, currentContext: () => context, forward, onOperation };
    const service = new ControlSendService(options);
    const request = () => ({
        id: randomUUID(),
        expected: { ...context },
        account: "mock/001.foo",
        targetType: "private",
        targetId: 123,
        message: "synthetic-secret-message",
    });
    return { directory, context, forward, onOperation, options, service, request };
}
describe("persistent control send", () => {
    it("projects persisted intent and terminal state without message contents", async () => {
        const f = fixture(),
            request = f.request();
        await f.service.send(owner, request);
        expect(f.onOperation).toHaveBeenNthCalledWith(1, {
            id: request.id,
            action: "message.send",
            status: "running",
        });
        expect(f.onOperation).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                id: request.id,
                action: "message.send",
                status: "succeeded",
                finishedAt: expect.any(String),
            }),
        );
        expect(JSON.stringify(f.onOperation.mock.calls)).not.toContain(request.message);
        expect(JSON.stringify(f.onOperation.mock.calls)).not.toContain(request.account);
    });

    it("permits explicit local recovery queries without changing owner or dispatching", async () => {
        const f = fixture(),
            request = f.request();
        const receipt = await f.service.send(owner, request);
        expect(() => f.service.operation("c".repeat(64), request.id)).toThrow();
        expect(f.service.operation("c".repeat(64), request.id, true)).toEqual(receipt);
        await expect(f.service.send("c".repeat(64), request)).rejects.toMatchObject({
            httpStatus: 404,
        });
        expect(f.forward).toHaveBeenCalledTimes(1);
    });
    it("records a trusted pre-dispatch rejection without retrying it", async () => {
        const f = fixture(),
            request = f.request();
        f.forward.mockRejectedValue(new GatewayRequestError("rejected", "账号离线"));
        const result = await f.service.send(owner, request);
        expect(result.status).toBe("rejected");
        expect(await f.service.send(owner, request)).toEqual(result);
        expect(f.forward).toHaveBeenCalledTimes(1);
    });
    it("persists intent before forwarding and never stores the message or target", async () => {
        const f = fixture(),
            request = f.request();
        f.forward.mockImplementation(async () => {
            expect(
                JSON.parse(fs.readFileSync(path.join(f.directory, `${request.id}.json`), "utf8"))
                    .status,
            ).toBe("running");
            return { messageId: "platform-id" };
        });
        const result = await f.service.send(owner, request);
        expect(result.status).toBe("succeeded");
        expect(await f.service.send(owner, request)).toEqual(result);
        expect(f.forward).toHaveBeenCalledTimes(1);
        const stored = fs.readFileSync(path.join(f.directory, `${request.id}.json`), "utf8");
        expect(stored).not.toContain(request.message);
        expect(stored).not.toContain(request.account);
        expect(stored).not.toContain("targetId");
        const restarted = new ControlSendService(f.options);
        f.context.gatewayInstanceId = randomUUID();
        expect(await restarted.send(owner, request)).toEqual(result);
        expect(f.forward).toHaveBeenCalledTimes(1);
    });
    it("binds whole request, owner, numeric ID type and expected versions", async () => {
        const f = fixture(),
            request = f.request();
        await f.service.send(owner, request);
        await expect(f.service.send(owner, { ...request, targetId: "123" })).rejects.toMatchObject({
            httpStatus: 409,
        });
        await expect(f.service.send("c".repeat(64), request)).rejects.toMatchObject({
            httpStatus: 404,
        });
        expect(() => f.service.operation("c".repeat(64), request.id)).toThrow();
        await expect(
            f.service.send(owner, {
                ...f.request(),
                expected: { ...f.context, configVersion: "c".repeat(64) },
            }),
        ).rejects.toMatchObject({ httpStatus: 409 });
        expect(f.forward).toHaveBeenCalledTimes(1);
    });
    it("snapshots callers before asynchronous dispatch settles", async () => {
        const f = fixture(),
            request = f.request();
        let resolve!: (result: { messageId: string }) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const pending = f.service.send(owner, request);
        request.message = "changed";
        request.expected.configVersion = "c".repeat(64);
        const passed = f.forward.mock.calls[0][0];
        expect(passed.message).toBe("synthetic-secret-message");
        resolve({ messageId: "one" });
        await pending;
    });
    it("records unknown on exceptions with no replay or raw error", async () => {
        const f = fixture(),
            request = f.request();
        f.forward.mockRejectedValueOnce(new Error("private-response"));
        expect((await f.service.send(owner, request)).status).toBe("unknown");
        expect((await f.service.send(owner, request)).status).toBe("unknown");
        expect(f.forward).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(path.join(f.directory, `${request.id}.json`), "utf8")).not.toContain(
            "private-response",
        );
    });
    it("cold running becomes unknown without forwarding", () => {
        const f = fixture(),
            request = parseSendRequest(f.request());
        new ControlSendStore(f.directory).create({
            schemaVersion: 1,
            id: request.id,
            ...request.expected,
            ownerHash: owner,
            requestDigest: sendDigest(request),
            status: "running",
            startedAt: new Date().toISOString(),
        });
        f.onOperation.mockClear();
        const restarted = new ControlSendService(f.options);
        expect(restarted.operation(owner, request.id).status).toBe("unknown");
        expect(f.onOperation).toHaveBeenCalledWith(
            expect.objectContaining({
                id: request.id,
                action: "message.send",
                status: "unknown",
                finishedAt: expect.any(String),
            }),
        );
        expect(f.forward).not.toHaveBeenCalled();
    });
    it("failed intent write gates new sends without dispatch", async () => {
        const f = fixture();
        vi.spyOn(ServiceOperationStorage.prototype, "write").mockImplementationOnce(() => {
            throw new Error("disk");
        });
        await expect(f.service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 503 });
        await expect(f.service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 503 });
        expect(f.forward).not.toHaveBeenCalled();
    });
    it("failed completion persistence yields unknown query and domain-only gate", async () => {
        const f = fixture(),
            request = f.request();
        const original = ServiceOperationStorage.prototype.write;
        vi.spyOn(ServiceOperationStorage.prototype, "write").mockImplementation(
            function (name, value, createOnly) {
                if (!createOnly) throw new Error("disk");
                return original.call(this, name, value, createOnly);
            },
        );
        await expect(f.service.send(owner, request)).rejects.toMatchObject({ httpStatus: 503 });
        expect(f.service.operation(owner, request.id).status).toBe("unknown");
        expect(f.service.health().available).toBe(false);
        expect(f.service.context()).toEqual(f.context);
    });
    it("rejects at the record capacity without deleting audit files", async () => {
        const f = fixture();
        const request = f.request();
        await f.service.send(owner, request);
        // Simulate the storage inventory at its documented bound; the real record is still strictly read.
        vi.spyOn(ServiceOperationStorage.prototype, "list").mockReturnValue(
            Array(10000).fill(`${request.id}.json`),
        );
        await expect(f.service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 429 });
        expect(f.forward).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(f.directory, `${request.id}.json`))).toBe(true);
        expect(f.service.health().available).toBe(true);
    });
    it("corrupt log blocks new sends but does not throw from construction", async () => {
        const f = fixture();
        fs.writeFileSync(path.join(f.directory, `${randomUUID()}.json`), "{", { mode: 0o600 });
        const service = new ControlSendService(f.options);
        expect(service.health().available).toBe(false);
        await expect(service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 503 });
        expect(f.forward).not.toHaveBeenCalled();
    });
    it("limits in-flight requests and close waits only for bounded terminal writes", async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.forward.mockImplementation(() => new Promise(() => {}));
        const requests = Array.from({ length: 8 }, () => f.request());
        const pending = requests.map(request => f.service.send(owner, request));
        await expect(f.service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 429 });
        const closing = f.service.close();
        await expect(f.service.send(owner, f.request())).rejects.toMatchObject({ httpStatus: 503 });
        await vi.advanceTimersByTimeAsync(30001);
        await closing;
        expect((await Promise.all(pending)).every(result => result.status === "unknown")).toBe(
            true,
        );
    });
    it("late success cannot overwrite the timeout record", async () => {
        vi.useFakeTimers();
        const f = fixture(),
            request = f.request();
        let resolve!: (result: { messageId: string }) => void;
        f.forward.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const pending = f.service.send(owner, request);
        await vi.advanceTimersByTimeAsync(30001);
        expect((await pending).status).toBe("unknown");
        resolve({ messageId: "late" });
        await Promise.resolve();
        expect(f.service.operation(owner, request.id).status).toBe("unknown");
    });
});
