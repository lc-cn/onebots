import { describe, expect, it, vi } from "vitest";
import { createAdaptiveCardInvokeResponse, TeamsInvokeResponder } from "./invoke-response.js";
import type { TeamsEvent } from "./types.js";

describe("Teams Invoke 响应", () => {
    it("合并相同 Activity 的并发处理", async () => {
        let release: (() => void) | undefined;
        const handler = vi.fn(
            () =>
                new Promise<{ status: number; body: { ok: boolean } }>(resolve => {
                    release = () => resolve({ status: 200, body: { ok: true } });
                }),
        );
        const responder = new TeamsInvokeResponder();
        responder.setHandler(handler);
        const event = createInvokeEvent("invoke-1");

        const first = responder.respond(event);
        const retry = responder.respond(event);
        expect(handler).toHaveBeenCalledOnce();
        release?.();

        await expect(Promise.all([first, retry])).resolves.toEqual([
            { status: 200, body: { ok: true } },
            { status: 200, body: { ok: true } },
        ]);
    });

    it("更换处理器后不复用旧代际缓存", async () => {
        const responder = new TeamsInvokeResponder();
        const first = vi.fn().mockReturnValue({ status: 200, body: { generation: 1 } });
        const second = vi.fn().mockReturnValue({ status: 200, body: { generation: 2 } });
        const event = createInvokeEvent("invoke-2");

        responder.setHandler(first);
        await responder.respond(event);
        responder.setHandler(second);

        await expect(responder.respond(event)).resolves.toEqual({
            status: 200,
            body: { generation: 2 },
        });
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it("拒绝非法状态和不可序列化的响应", async () => {
        const responder = new TeamsInvokeResponder();
        responder.setHandler(() => ({ status: 99 }));
        await expect(responder.respond(createInvokeEvent("invoke-3"))).rejects.toThrow(
            /100 到 599/u,
        );

        responder.setHandler(() => ({ status: 200, body: new Map() }));
        await expect(responder.respond(createInvokeEvent("invoke-4"))).rejects.toThrow(
            /可序列化的 JSON/u,
        );
    });

    it("构造 Universal Action 规定的双层状态响应", () => {
        expect(
            createAdaptiveCardInvokeResponse("application/json", { refreshed: true }, 409),
        ).toEqual({
            status: 200,
            body: {
                statusCode: 409,
                type: "application/json",
                value: { refreshed: true },
            },
        });
    });
});

function createInvokeEvent(id: string): TeamsEvent {
    return {
        type: "invoke",
        activity: {
            id,
            type: "invoke",
            timestamp: "2026-08-30T00:00:00.000Z",
            channelId: "msteams",
            from: { id: "user-1" },
            recipient: { id: "bot-1" },
            conversation: { id: "conversation-1" },
            name: "task/fetch",
        },
        raw_activity: {},
    };
}
