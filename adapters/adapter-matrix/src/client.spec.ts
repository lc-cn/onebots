import { describe, expect, it, vi } from "vitest";
import { MatrixClient } from "./client.js";
import type { MatrixConfig } from "./types.js";

const manualConfig: MatrixConfig = {
    account_id: "bot",
    homeserver_url: "https://matrix.example.com",
    access_token: "access",
    user_id: "@bot:example.com",
    receive_mode: "manual",
};

const event = {
    event_id: "$event:example.com",
    type: "m.room.message",
    room_id: "!room:example.com",
    sender: "@alice:example.com",
    origin_server_ts: 1,
    content: { msgtype: "m.text", body: "hello" },
};

describe("MatrixClient", () => {
    it("manual ingest 只在监听器成功后去重，失败允许重投", async () => {
        const client = new MatrixClient(manualConfig);
        const listener = vi.fn().mockRejectedValueOnce(new Error("downstream failed"));
        client.on("event", listener);

        await expect(client.ingest(event)).rejects.toThrow("downstream failed");
        await expect(client.ingest(event)).resolves.toMatchObject({
            accepted: true,
            duplicate: false,
        });
        await expect(client.ingest(event)).resolves.toMatchObject({
            accepted: false,
            duplicate: true,
        });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("AppService transaction 严格校验 Bearer token 并按 txnId 幂等 ACK", async () => {
        const client = new MatrixClient({
            ...manualConfig,
            access_token: undefined,
            receive_mode: "appservice",
            appservice_id: "onebots",
            as_token: "as-secret",
            hs_token: "hs-secret",
        });
        const listener = vi.fn();
        client.on("event", listener);
        const request = () =>
            new Request(
                "https://host.example/matrix/bot/appservice/_matrix/app/v1/transactions/txn-1",
                {
                    method: "PUT",
                    headers: {
                        authorization: "Bearer hs-secret",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ events: [event], ephemeral: [] }),
                },
            );

        const first = await client.acceptHttp(request());
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual({});
        const duplicate = await client.acceptHttp(request());
        expect(duplicate.status).toBe(200);
        expect(listener).toHaveBeenCalledOnce();

        const rejected = await client.acceptHttp(
            new Request("https://host.example/_matrix/app/v1/transactions/txn-2", {
                method: "PUT",
                headers: { authorization: "Bearer wrong", "content-type": "application/json" },
                body: JSON.stringify({ events: [] }),
            }),
        );
        expect(rejected.status).toBe(403);
        await expect(rejected.json()).resolves.toMatchObject({ errcode: "M_FORBIDDEN" });

        const queryOnly = await client.acceptHttp(
            new Request(
                "https://host.example/_matrix/app/v1/transactions/txn-3?access_token=hs-secret",
                {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ events: [] }),
                },
            ),
        );
        expect(queryOnly.status).toBe(401);
    });

    it("对已知路由错误方法返回 405，对未知路由返回 404", async () => {
        const client = new MatrixClient({
            ...manualConfig,
            receive_mode: "appservice",
            appservice_id: "onebots",
            as_token: "as-secret",
            hs_token: "hs-secret",
        });
        const wrongMethod = await client.acceptHttp(
            new Request("https://host.example/_matrix/app/v1/ping", { method: "PUT" }),
        );
        expect(wrongMethod.status).toBe(405);
        const unknown = await client.acceptHttp(
            new Request("https://host.example/_matrix/app/v1/unknown", { method: "POST" }),
        );
        expect(unknown.status).toBe(404);
        const namespaceQuery = await client.acceptHttp(
            new Request("https://host.example/_matrix/app/v1/users/%40ghost%3Aexample.com", {
                headers: { authorization: "Bearer hs-secret" },
            }),
        );
        expect(namespaceQuery.status).toBe(404);
        await expect(namespaceQuery.json()).resolves.toMatchObject({ errcode: "M_NOT_FOUND" });
    });

    it("已观察 reaction 被 redaction 时补充确定的 reaction_removed 上下文", async () => {
        const client = new MatrixClient(manualConfig);
        const received: unknown[] = [];
        client.on("event", value => received.push(value));
        await client.ingest({
            type: "m.reaction",
            event_id: "$reaction",
            room_id: "!room:example.com",
            content: {
                "m.relates_to": { rel_type: "m.annotation", event_id: "$message", key: "👍" },
            },
        });
        await client.ingest({
            type: "m.room.redaction",
            event_id: "$redaction",
            room_id: "!room:example.com",
            redacts: "$reaction",
            content: {},
        });
        expect(received[1]).toMatchObject({
            redacted_reaction: { event_id: "$message", key: "👍" },
        });
    });

    it("把 m.typing 快照转换为准确的开始和停止增量", async () => {
        const client = new MatrixClient(manualConfig);
        const received: unknown[] = [];
        client.on("event", envelope => received.push(envelope));

        await client.ingest({
            type: "m.typing",
            room_id: "!room:example.com",
            content: { user_ids: ["@a:hs", "@b:hs"] },
        });
        await client.ingest({
            type: "m.typing",
            room_id: "!room:example.com",
            content: { user_ids: ["@b:hs", "@c:hs"] },
        });

        expect(received).toMatchObject([
            { typing_delta: { started: ["@a:hs", "@b:hs"], stopped: [] } },
            { typing_delta: { started: ["@c:hs"], stopped: ["@a:hs"] } },
        ]);
    });

    it("AppService 下游失败返回 500 并允许 homeserver 用同一 txnId 重投", async () => {
        const client = new MatrixClient({
            ...manualConfig,
            receive_mode: "appservice",
            appservice_id: "onebots",
            as_token: "as-secret",
            hs_token: "hs-secret",
        });
        const listener = vi.fn().mockRejectedValueOnce(new Error("protocol unavailable"));
        client.on("event", listener);
        const deliver = () =>
            client.acceptHttp(
                new Request("https://host.example/_matrix/app/v1/transactions/retry-txn", {
                    method: "PUT",
                    headers: {
                        authorization: "Bearer hs-secret",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ events: [{ ...event, event_id: "$retry" }] }),
                }),
            );
        expect((await deliver()).status).toBe(500);
        expect((await deliver()).status).toBe(200);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("通用 call 拒绝绝对 URL，并保留 Matrix 限流错误", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    errcode: "M_LIMIT_EXCEEDED",
                    error: "slow",
                    retry_after_ms: 2500,
                }),
                {
                    status: 429,
                    headers: { "content-type": "application/json" },
                },
            ),
        );
        const client = new MatrixClient(manualConfig, { fetcher });
        await expect(client.call("GET", "https://evil.example/me")).rejects.toThrow(/pathname/u);
        await expect(client.call("GET", "/_matrix/client/v3/account/whoami")).rejects.toMatchObject(
            {
                code: "M_LIMIT_EXCEEDED",
                status: 429,
                retryAfterMs: 2500,
            },
        );
    });

    it("start 以 whoami 闭合身份并拒绝 token 身份漂移", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ user_id: "@other:example.com" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new MatrixClient(manualConfig, { fetcher });
        await expect(client.start()).rejects.toMatchObject({ code: "MATRIX_IDENTITY_MISMATCH" });
    });

    it("并发 start 复用同一个身份校验，成功后保持幂等", async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(
            async () =>
                new Response(JSON.stringify({ user_id: manualConfig.user_id }), {
                    headers: { "content-type": "application/json" },
                }),
        );
        const client = new MatrixClient(manualConfig, { fetcher });

        const [first, second] = await Promise.all([client.start(), client.start()]);
        expect(first).toEqual(second);
        await expect(client.start()).resolves.toEqual(first);
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("ready 监听器失败不会提交启动状态，修复后可重新启动", async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(
            async () =>
                new Response(JSON.stringify({ user_id: manualConfig.user_id }), {
                    headers: { "content-type": "application/json" },
                }),
        );
        const client = new MatrixClient(manualConfig, { fetcher });
        const ready = vi.fn().mockRejectedValueOnce(new Error("bootstrap failed"));
        client.on("ready", ready);

        await expect(client.start()).rejects.toThrow("bootstrap failed");
        await expect(client.start()).resolves.toMatchObject({ user_id: manualConfig.user_id });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("stop 会使尚未完成的 start 失效，迟到的 whoami 不会令 Client 重新上线", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const fetcher = vi.fn<typeof fetch>().mockImplementation(
            () =>
                new Promise<Response>(resolve => {
                    resolveResponse = resolve;
                }),
        );
        const client = new MatrixClient(manualConfig, { fetcher });
        const start = client.start();

        await client.stop();
        resolveResponse?.(
            new Response(JSON.stringify({ user_id: manualConfig.user_id }), {
                headers: { "content-type": "application/json" },
            }),
        );

        await expect(start).rejects.toMatchObject({ code: "MATRIX_START_CANCELLED" });
    });

    it("AppService transaction 拒绝非 Matrix 事件，而不是 ACK 后静默丢弃", async () => {
        const client = new MatrixClient({
            ...manualConfig,
            receive_mode: "appservice",
            appservice_id: "onebots",
            as_token: "as-secret",
            hs_token: "hs-secret",
        });
        const response = await client.acceptHttp(
            new Request("https://host.example/_matrix/app/v1/transactions/malformed", {
                method: "PUT",
                headers: {
                    authorization: "Bearer hs-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify({ events: [{ type: "m.room.message", content: "bad" }] }),
            }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ errcode: "M_BAD_JSON" });
    });

    it("结构化 Host 传入无效 URL 时返回 Matrix 错误而不是抛出", async () => {
        const client = new MatrixClient(manualConfig);
        await expect(
            client.ingestHttp({ method: "POST", url: "https://[invalid", body: {} }),
        ).resolves.toMatchObject({ status: 400, body: { errcode: "M_BAD_JSON" } });
    });
});
