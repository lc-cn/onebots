import { describe, expect, it, vi } from "vitest";
import { WeComClient } from "./client.js";
import type { WeComConfig, WeComEvent } from "./types.js";

const config: WeComConfig = {
    account_id: "bot",
    corp_id: "ww-corp",
    corp_secret: "secret",
    agent_id: "1000001",
    token: "token",
    encoding_aes_key: Buffer.alloc(32, 1).toString("base64").slice(0, 43),
};
const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    });

describe("WeComClient", () => {
    it("token 失效时并发安全地刷新并重试一次", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "old", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 40014, errmsg: "invalid token" }))
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "new", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 0, errmsg: "ok", userid: "u1", name: "User" }));
        const client = new WeComClient(config, fetcher);
        await expect(client.getUserInfo("u1")).resolves.toMatchObject({ userid: "u1" });
        expect(String(fetcher.mock.calls[3]?.[0])).toContain("access_token=new");
    });

    it.each([
        "https://evil.example",
        "//evil.example/path",
        "/cgi-bin/../gettoken",
        "/cgi-bin/%2e%2e/gettoken",
        "/cgi-bin/user/get?userid=forged",
        "/cgi-bin/user/get#fragment",
    ])("拒绝危险或夹带 URL 语义的 API 路径: %s", async path => {
        const client = new WeComClient(config);
        await expect(client.call({ path })).rejects.toMatchObject({
            code: "WECOM_INVALID_API_PATH",
        });
    });

    it("拒绝非数字 AgentID", () => {
        expect(() => new WeComClient({ ...config, agent_id: "app" })).toThrowError(
            expect.objectContaining({ code: "WECOM_INVALID_AGENT_ID" }),
        );
    });

    it("迟到的旧 token 错误不会清空已经刷新的新 token", async () => {
        const oldResponses: Array<(response: Response) => void> = [];
        let tokenRequests = 0;
        const fetcher = vi.fn<typeof fetch>(async input => {
            const url = String(input);
            if (url.includes("/cgi-bin/gettoken")) {
                tokenRequests += 1;
                return json({
                    errcode: 0,
                    access_token: tokenRequests === 1 ? "old" : "new",
                    expires_in: 7200,
                });
            }
            if (url.includes("access_token=old")) {
                return new Promise(resolve => oldResponses.push(resolve));
            }
            return json({ errcode: 0, userid: url.includes("userid=a") ? "a" : "b" });
        });
        const client = new WeComClient(config, fetcher);
        await client.getAccessToken();
        const first = client.getUserInfo("a");
        const second = client.getUserInfo("b");
        await vi.waitFor(() => expect(oldResponses).toHaveLength(2));
        oldResponses[0]!(json({ errcode: 40014, errmsg: "invalid token" }));
        await expect(first).resolves.toMatchObject({ userid: "a" });
        oldResponses[1]!(json({ errcode: 40014, errmsg: "invalid token" }));
        await expect(second).resolves.toMatchObject({ userid: "b" });
        expect(tokenRequests).toBe(2);
    });

    it("将平台 errcode 保留为结构化错误", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "token", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 60111, errmsg: "userid not found" }));
        const client = new WeComClient(config, fetcher);
        await expect(client.getUserInfo("missing")).rejects.toMatchObject({
            code: "WECOM_60111",
            path: "/cgi-bin/user/get",
            details: { errcode: 60111, errmsg: "userid not found" },
        });
    });

    it("不使用本地合成 ID 调用撤回接口", async () => {
        const client = new WeComClient(config);
        await expect(client.recallMessage("appchat:local-id")).rejects.toMatchObject({
            code: "WECOM_MESSAGE_NOT_RECALLABLE",
        });
    });

    it("统一 ingest 同时分发 raw_event 与细粒度事件", () => {
        const client = new WeComClient(config);
        const raw = vi.fn();
        const message = vi.fn();
        client.on("raw_event", raw);
        client.on("message", message);
        const event: WeComEvent = {
            MsgType: "text",
            MsgId: "m1",
            CreateTime: 1_777_000_000,
            FromUserName: "u1",
            Content: "hi",
        };
        expect(client.ingest(event)).toMatchObject({
            accepted: 1,
            duplicate: false,
            eventId: "m1",
        });
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledWith(event);
        expect(client.ingest(event).duplicate).toBe(true);
    });

    it("ingest 拒绝无法稳定投影的外部事件", () => {
        const client = new WeComClient(config);
        expect(() => client.ingest({ MsgType: "text", Content: "hi" })).toThrowError(
            expect.objectContaining({ code: "WECOM_INVALID_EVENT" }),
        );
    });

    it("manual 模式无需回调凭据，并支持精确事件订阅", () => {
        const client = new WeComClient({
            ...config,
            receive_mode: "manual",
            token: undefined,
            encoding_aes_key: undefined,
        });
        const listener = vi.fn();
        const unsubscribe = client.onEvent("enter_agent", listener);
        const event: WeComEvent = {
            MsgType: "event",
            Event: "enter_agent",
            CreateTime: 1_777_000_001,
            FromUserName: "u1",
        };
        expect(client.ingest(event).accepted).toBe(1);
        expect(listener).toHaveBeenCalledWith(event);
        unsubscribe();
        client.ingest({ ...event, CreateTime: 1_777_000_002 });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("业务监听器失败时不提交去重状态，允许企业微信重投递", () => {
        const client = new WeComClient({ ...config, receive_mode: "manual" });
        const event: WeComEvent = {
            MsgType: "event",
            Event: "enter_agent",
            CreateTime: 1_777_000_003,
            FromUserName: "u1",
        };
        const failure = (): void => {
            throw new Error("downstream failed");
        };
        client.on("raw_event", failure);
        expect(() => client.ingest(event)).toThrow("downstream failed");
        client.off("raw_event", failure);
        expect(client.ingest(event).duplicate).toBe(false);
    });

    it("标准 Request Host 拒绝不支持的方法", async () => {
        const client = new WeComClient(config);
        const response = await client.acceptHttp(
            new Request("https://example.test/wecom", { method: "PUT" }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, POST");
    });
});
