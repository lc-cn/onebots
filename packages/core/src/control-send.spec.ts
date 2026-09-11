import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ControlClient, type ControlTransport } from "./control.js";
import { isControlSendRequest, type ControlSendRequest } from "./control-send.js";

function request(): ControlSendRequest {
    return {
        id: randomUUID(),
        expected: { gatewayInstanceId: randomUUID(), configVersion: "a".repeat(64) },
        account: "mock/account.with/suffix",
        targetType: "private",
        targetId: "00123",
        message: "literal [CQ:at,qq=123]\ntext",
    };
}

describe("send control contract", () => {
    it("preserves numeric and original string IDs without coercion", () => {
        for (const id of [123, "123", "00123", "room/member"]) {
            const value = { ...request(), targetId: id };
            expect(isControlSendRequest(value)).toBe(true);
            expect(value.targetId).toBe(id);
        }
    });
    it("rejects ambiguous, excessive and non-data fields", () => {
        const base = request();
        for (const value of [
            { ...base, id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
            { ...base, targetId: NaN },
            { ...base, targetId: 1.5 },
            { ...base, targetId: Number.MAX_SAFE_INTEGER + 1 },
            { ...base, targetType: { toString: () => "private" } },
            { ...base, account: "mock/" },
            { ...base, message: "中".repeat(32768) },
            { ...base, expected: { ...base.expected, extra: true } },
            { ...base, extra: true },
            Object.defineProperty({ ...base }, "message", { get: () => "secret" }),
        ])
            expect(isControlSendRequest(value)).toBe(false);
    });
    it("uses separate query and submission routes and never retries unknown sends", async () => {
        const transport = vi
            .fn<ControlTransport["request"]>()
            .mockRejectedValue(new Error("unknown"));
        const client = new ControlClient({ request: transport });
        const body = request();
        await expect(client.sendMessage(body)).rejects.toThrow("unknown");
        expect(transport).toHaveBeenCalledExactlyOnceWith(
            "POST",
            "/api/control/messages/send",
            body,
        );
        await expect(client.sendOperation(body.id)).rejects.toThrow();
        expect(transport).toHaveBeenLastCalledWith(
            "GET",
            `/api/control/messages/operations/${body.id}`,
        );
        await expect(client.sendContext()).rejects.toThrow();
        expect(transport).toHaveBeenLastCalledWith("GET", "/api/control/messages/context");
    });
});
