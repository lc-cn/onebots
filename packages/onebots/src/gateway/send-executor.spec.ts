import { randomUUID } from "node:crypto";
import type { BaseApp } from "@onebots/core";
import type { ControlSendRequest } from "@onebots/core/control";
import { expect, it, vi } from "vitest";
import { GatewaySendExecutor } from "./send-executor.js";
import { isGatewaySendMessage, isGatewaySendReply } from "./send-contracts.js";
import { handleGatewaySendMessage } from "./send-ipc.js";
function fixture() {
    const context = { gatewayInstanceId: randomUUID(), configVersion: "a".repeat(64) };
    const resolveId = vi.fn((id: string | number) => ({ string: String(id), number: 123 }));
    const sendMessage = vi.fn(async () => ({ message_id: { string: "001/message", number: 456 } }));
    const adapter = {
        accounts: new Map([["account/with/slash", { status: "online" }]]),
        resolveId,
        sendMessage,
    };
    const app = { adapters: new Map([["mock", adapter]]) } as unknown as Pick<BaseApp, "adapters">;
    const executor = new GatewaySendExecutor(app, context);
    const request = (targetId: string | number = "001"): ControlSendRequest => ({
        id: randomUUID(),
        expected: context,
        account: "mock/account/with/slash",
        targetType: "private",
        targetId,
        message: "[CQ:image,file=no] <text>",
    });
    return { context, resolveId, sendMessage, adapter, executor, request };
}
it("does not infer confirmed delivery from a missing SDK acknowledgement", async () => {
    for (const result of [undefined, {}, { message_id: undefined }]) {
        const f = fixture();
        Object.assign(f.adapter, { sendMessage: vi.fn(async () => result) });
        expect(await f.executor.send(f.request())).toEqual({ outcome: "unknown" });
    }
});
it("preserves string and number ID inputs, literal text and returned ID projection", async () => {
    const f = fixture();
    for (const target of [123, "00123"]) {
        const result = await f.executor.send(f.request(target));
        expect(f.resolveId).toHaveBeenLastCalledWith(target);
        expect(f.sendMessage).toHaveBeenLastCalledWith("account/with/slash", {
            scene_type: "private",
            scene_id: { string: String(target), number: 123 },
            message: [{ type: "text", data: { text: "[CQ:image,file=no] <text>" } }],
        });
        expect(result).toEqual({ outcome: "succeeded", result: { messageId: "001/message" } });
    }
});
it("mismatch and missing/offline accounts are rejected before dispatch", async () => {
    const f = fixture(),
        request = f.request();
    expect(
        await f.executor.send({
            ...request,
            expected: { ...request.expected, configVersion: "b".repeat(64) },
        }),
    ).toEqual({ outcome: "rejected" });
    expect(await f.executor.send({ ...request, account: "mock/missing" })).toEqual({
        outcome: "rejected",
    });
    f.adapter.accounts.get("account/with/slash")!.status = "offline";
    expect(await f.executor.send(request)).toEqual({ outcome: "rejected" });
    expect(f.sendMessage).not.toHaveBeenCalled();
    f.adapter.accounts.get("account/with/slash")!.status = "online";
    await f.executor.send(request);
    expect(f.sendMessage).toHaveBeenCalledOnce();
});
it("SDK errors are unknown; eight unsettled calls retain capacity until actually settled", async () => {
    const f = fixture(),
        pending = Array.from({ length: 8 }, () =>
            Promise.withResolvers<{ message_id: { string: string; number: number } }>(),
        );
    const calls = pending.map(p => {
        f.sendMessage.mockReturnValueOnce(p.promise);
        return f.executor.send(f.request());
    });
    expect(await f.executor.send(f.request())).toEqual({ outcome: "rejected" });
    pending[0].reject(new Error("private-token"));
    expect(await calls[0]).toEqual({ outcome: "unknown" });
    expect((await f.executor.send(f.request())).outcome).toBe("succeeded");
    f.executor.close();
    expect(await f.executor.send(f.request())).toEqual({ outcome: "rejected" });
    expect(f.sendMessage).toHaveBeenCalledTimes(9);
    for (const p of pending.slice(1)) p.resolve({ message_id: { string: "done", number: 1 } });
    await Promise.all(calls);
});
it("closed IPC checks both identities, operation and bounded frames without error text", async () => {
    const f = fixture(),
        identity = {
            protocolVersion: 1 as const,
            controlInstanceId: randomUUID(),
            gatewayInstanceId: f.context.gatewayInstanceId,
        };
    const message = {
        ...identity,
        type: "gateway.send",
        requestId: randomUUID(),
        request: f.request(),
    };
    expect(isGatewaySendMessage(message)).toBe(true);
    expect(isGatewaySendMessage({ ...message, secret: "x" })).toBe(false);
    expect(
        isGatewaySendMessage({
            ...message,
            request: { ...message.request, message: "x".repeat(32769) },
        }),
    ).toBe(false);
    const send = vi.fn();
    handleGatewaySendMessage(
        { ...message, controlInstanceId: randomUUID() },
        identity,
        f.executor,
        send,
    );
    expect(f.sendMessage).not.toHaveBeenCalled();
    handleGatewaySendMessage(message, identity, f.executor, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(isGatewaySendReply(send.mock.calls[0][0])).toBe(true);
    expect(send.mock.calls[0][0]).toMatchObject({
        operationId: message.request.id,
        configVersion: f.context.configVersion,
        result: { messageId: "001/message" },
    });
});
