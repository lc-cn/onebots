import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { GatewayRequestClient } from "./gateway-request-client.js";
import { requestGatewayVerification } from "./gateway-verification-client.js";

it("只接受原查询身份，unknown 状态是成功查询证据而非通信错误", async () => {
    const child = Object.assign(new EventEmitter(), {
        connected: true,
        exitCode: null,
        signalCode: null,
        send: vi.fn(),
    });
    const client = new GatewayRequestClient(child as unknown as ChildProcess, 1000);
    const identity = {
        protocolVersion: 1 as const,
        controlInstanceId: randomUUID(),
        gatewayInstanceId: randomUUID(),
        configVersion: "v1",
    };
    const operation = {
        action: "query" as const,
        operationId: randomUUID(),
        challengeId: randomUUID(),
        verificationAction: "submit" as const,
    };
    try {
        const result = requestGatewayVerification(client, identity, operation);
        const frame = child.send.mock.calls[0][0];
        const reply = {
            ...frame,
            type: "gateway.verification.result",
            outcome: "succeeded",
            state: "unknown",
        };
        let settled = false;
        void result.then(() => {
            settled = true;
        });
        for (const wrong of [
            { operationId: randomUUID() },
            { challengeId: randomUUID() },
            { verificationAction: "request-sms" },
            { gatewayInstanceId: randomUUID() },
            { controlInstanceId: randomUUID() },
            { configVersion: "v0" },
            { requestId: randomUUID() },
        ])
            child.emit("message", { ...reply, ...wrong });
        await Promise.resolve();
        expect(settled).toBe(false);
        child.emit("message", reply);
        expect(await result).toEqual(reply);
        expect(child.send).toHaveBeenCalledOnce();
    } finally {
        client.close();
    }
});
