import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { GatewayRequestClient } from "./gateway-request-client.js";
import { requestGatewayMessageDebug } from "./gateway-message-debug-client.js";

it("清空确认丢失时保持 unknown，断连及超时均不重发", async () => {
    for (const disconnect of [false, true]) {
        let sent = 0;
        const child = Object.assign(new EventEmitter(), {
            connected: true,
            exitCode: null,
            signalCode: null,
            send: (_value: unknown, callback: (error: Error | null) => void) => {
                sent++;
                callback(null);
                if (disconnect) queueMicrotask(() => child.emit("disconnect"));
            },
        });
        const requests = new GatewayRequestClient(child as unknown as ChildProcess, 20);
        try {
            await expect(
                requestGatewayMessageDebug(
                    requests,
                    {
                        protocolVersion: 1,
                        controlInstanceId: randomUUID(),
                        gatewayInstanceId: randomUUID(),
                    },
                    "clear",
                ),
            ).rejects.toMatchObject({ outcome: "unknown" });
            expect(sent).toBe(1);
        } finally {
            requests.close();
        }
    }
});
