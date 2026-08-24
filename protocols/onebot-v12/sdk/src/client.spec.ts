import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createOnebot12Client } from "./client.js";
import type { OneBotV12Event } from "./types.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("OneBot V12 client", () => {
    test("keeps raw event type and supports a custom action URL resolver", async () => {
        const fetchMock = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok", retcode: 0, data: {} })),
        );
        vi.stubGlobal("fetch", fetchMock);
        const client = createOnebot12Client({
            baseUrl: "https://events.example/onebot/v12",
            apiBaseUrl: "https://api.example",
            resolveActionUrl: action => `https://actions.example/${action}`,
            selfId: "bot",
            receiveMode: "ws",
        });

        client.on("event", event => expectTypeOf(event).toEqualTypeOf<OneBotV12Event>());
        await client.call("get_self_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://actions.example/get_self_info",
            expect.objectContaining({ method: "POST" }),
        );
    });

    test("preserves the legacy OneBots route when apiBaseUrl is omitted", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })));
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            platform: "kook",
            selfId: "bot",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await client.call("get_self_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://gateway.example/kook/bot/onebot/v12/get_self_info",
            expect.any(Object),
        );
    });
});
