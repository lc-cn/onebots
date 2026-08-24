import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createSatoriClient } from "./client.js";
import type { SatoriV1Event } from "./types.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Satori V1 client", () => {
    test("uses login.user.id for bot projection and exposes resource call", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify([])));
        vi.stubGlobal("fetch", fetchMock);
        const client = createSatoriClient({
            baseUrl: "https://events.example/v1",
            apiBaseUrl: "https://api.example/v1",
            selfId: "configured-fallback",
            receiveMode: "ws",
        });
        const projected = vi.fn();
        client.adapter.on("message.private", projected);
        client.on("event", event => expectTypeOf(event).toEqualTypeOf<SatoriV1Event>());

        client.ingest({
            id: "evt-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            login: { user: { id: "zhin-bot" }, status: 1 },
            user: { id: "user-1" },
            message: { id: "msg-1", content: "你好", created_at: 1_700_000_000_000 },
        });
        const response = await client.call<unknown[]>("message", "create", {
            channel_id: "channel-1",
            content: "你好",
        });

        expect(projected).toHaveBeenCalledWith(expect.objectContaining({ bot_id: "zhin-bot" }));
        expect(response).toEqual([]);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example/v1/message.create",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ channel_id: "channel-1", content: "你好" }),
                headers: expect.objectContaining({
                    "Satori-Platform": "unknown",
                    "Satori-User-ID": "configured-fallback",
                }),
            }),
        );
    });

    test("unwraps the legacy OneBots response when apiBaseUrl is omitted", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "bot" } })));
        const client = createSatoriClient({
            baseUrl: "https://gateway.example",
            platform: "kook",
            selfId: "bot",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await expect(client.call("login", "get")).resolves.toEqual({ id: "bot" });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://gateway.example/kook/bot/satori/v1/login.get",
            expect.any(Object),
        );
    });
});
