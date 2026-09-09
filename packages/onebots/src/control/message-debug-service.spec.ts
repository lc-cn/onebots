import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ControlMessageDebugService } from "./message-debug-service.js";
import type { GatewayMessageDebugReply } from "../gateway/message-debug-contracts.js";

function fixture() {
    let current: string | undefined = randomUUID();
    const forward = vi.fn(
        async (id: string, action: "history" | "clear"): Promise<GatewayMessageDebugReply> => ({
            type: "gateway.message-debug.result",
            protocolVersion: 1,
            controlInstanceId: randomUUID(),
            gatewayInstanceId: id,
            requestId: randomUUID(),
            ...(action === "history"
                ? { action, outcome: "succeeded", result: { entries: [] } }
                : {
                      action,
                      outcome: "succeeded",
                      result: { clearedCount: 1, clearedThroughSeq: 2 },
                  }),
        }),
    );
    const service = new ControlMessageDebugService({ currentInstance: () => current, forward });
    return {
        service,
        forward,
        id: current,
        change: (id?: string) => {
            current = id;
        },
    };
}
it("历史与清空属于同一当前实例，不将旧实例清空转发给新实例", async () => {
    const f = fixture();
    expect(await f.service.history()).toEqual({ gatewayInstanceId: f.id, entries: [] });
    expect(await f.service.clear({ expectedGatewayInstanceId: f.id })).toEqual({
        gatewayInstanceId: f.id,
        clearedCount: 1,
        clearedThroughSeq: 2,
    });
    f.change(randomUUID());
    await expect(f.service.clear({ expectedGatewayInstanceId: f.id })).rejects.toMatchObject({
        httpStatus: 409,
        outcome: "rejected",
    });
    expect(f.forward).toHaveBeenCalledTimes(2);
});
it.each(["stop", "replace", "close"])("%s 后迟到清空结果保持未知且不重发", async action => {
    const f = fixture();
    let resolve!: (reply: GatewayMessageDebugReply) => void;
    const reply = await f.forward(f.id, "clear");
    f.forward.mockClear();
    f.forward.mockImplementation(
        () =>
            new Promise(done => {
                resolve = done;
            }),
    );
    const pending = f.service.clear({ expectedGatewayInstanceId: f.id });
    if (action === "close") f.service.close();
    else f.change(action === "stop" ? undefined : randomUUID());
    resolve(reply);
    await expect(pending).rejects.toMatchObject({ outcome: "unknown", httpStatus: 409 });
    expect(f.forward).toHaveBeenCalledOnce();
});
it("未启动和非法清空请求均在派发前拒绝", async () => {
    const f = fixture();
    await expect(
        f.service.clear({ expectedGatewayInstanceId: f.id, extra: true }),
    ).rejects.toMatchObject({ httpStatus: 400 });
    f.change();
    await expect(f.service.history()).rejects.toMatchObject({
        httpStatus: 503,
        outcome: "rejected",
    });
    expect(f.forward).not.toHaveBeenCalled();
});
