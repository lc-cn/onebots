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

    it("统一 ingest 同时分发 raw_event 与细粒度事件", async () => {
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
        await expect(client.ingest(event)).resolves.toMatchObject({
            accepted: 1,
            duplicate: false,
            eventId: "m1",
        });
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledWith(event);
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: true });
    });

    it("ingest 拒绝无法稳定投影的外部事件", async () => {
        const client = new WeComClient(config);
        await expect(client.ingest({ MsgType: "text", Content: "hi" })).rejects.toThrowError(
            expect.objectContaining({ code: "WECOM_INVALID_EVENT" }),
        );
    });

    it("manual 模式无需回调凭据，并支持精确事件订阅", async () => {
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
        await expect(client.ingest(event)).resolves.toMatchObject({ accepted: 1 });
        expect(listener).toHaveBeenCalledWith(event);
        unsubscribe();
        await client.ingest({ ...event, CreateTime: 1_777_000_002 });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("业务监听器失败时不提交去重状态，允许企业微信重投递", async () => {
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
        await expect(client.ingest(event)).rejects.toThrow("downstream failed");
        client.off("raw_event", failure);
        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: false });
    });

    it("单个出口失败时仍投递其他 raw 与 typed 监听器", async () => {
        const client = new WeComClient({ ...config, receive_mode: "manual" });
        const failed = vi.fn().mockRejectedValueOnce(new Error("raw failed"));
        const secondRaw = vi.fn();
        const typed = vi.fn();
        client.on("raw_event", failed);
        client.on("raw_event", secondRaw);
        client.on("message", typed);
        const event: WeComEvent = {
            MsgType: "text",
            MsgId: "m-all-views",
            CreateTime: 1_777_000_003,
            FromUserName: "u1",
            Content: "hi",
        };

        await expect(client.ingest(event)).rejects.toThrow("raw failed");
        expect(secondRaw).toHaveBeenCalledOnce();
        expect(typed).toHaveBeenCalledOnce();

        await expect(client.ingest(event)).resolves.toMatchObject({ duplicate: false });
        expect(failed).toHaveBeenCalledTimes(2);
        expect(secondRaw).toHaveBeenCalledTimes(2);
        expect(typed).toHaveBeenCalledTimes(2);
    });

    it("生命周期等待异步监听器并向调用方传播失败", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "token", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", agentid: 1000001, name: "Bot" }),
            );
        const client = new WeComClient(config, fetcher);
        const ready = vi.fn().mockRejectedValue(new Error("ready failed"));
        const stopped = vi.fn().mockRejectedValue(new Error("stop failed"));
        client.on("ready", ready);
        client.on("stop", stopped);

        await expect(client.start()).rejects.toThrow("ready failed");
        await expect(client.stop()).rejects.toThrow("stop failed");
        expect(ready).toHaveBeenCalledWith(expect.objectContaining({ agentid: 1000001 }));
        expect(stopped).toHaveBeenCalledOnce();
    });

    it("并发启动共享完整初始化且 stop 使迟到响应失效", async () => {
        let releaseAgent!: (response: Response) => void;
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "token", expires_in: 7200 }),
            )
            .mockImplementationOnce(
                () => new Promise<Response>(resolve => (releaseAgent = resolve)),
            );
        const client = new WeComClient(config, fetcher);
        const ready = vi.fn(async () => undefined);
        const stopped = vi.fn(async () => undefined);
        client.on("ready", ready);
        client.on("stop", stopped);

        const first = client.start();
        const second = client.start();
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        await client.stop();
        releaseAgent(json({ errcode: 0, agentid: 1000001, name: "Bot" }));

        await expect(first).rejects.toMatchObject({ code: "WECOM_START_CANCELLED" });
        await expect(second).rejects.toMatchObject({ code: "WECOM_START_CANCELLED" });
        expect(ready).not.toHaveBeenCalled();
        expect(stopped).toHaveBeenCalledOnce();
        expect(client.getCachedAgent()).toBeUndefined();
    });

    it("并发成功启动只请求一次身份并只发出一次 ready", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "token", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 0, agentid: 1000001, name: "Bot" }));
        const client = new WeComClient(config, fetcher);
        const ready = vi.fn(async () => undefined);
        client.on("ready", ready);

        await Promise.all([client.start(), client.start()]);

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenCalledOnce();
        await client.stop();
    });

    it("等待异步监听器并合并同一事件的并发重投递", async () => {
        const client = new WeComClient({ ...config, receive_mode: "manual" });
        let release!: () => void;
        const listener = vi.fn(() => new Promise<void>(resolve => (release = resolve)));
        client.on("raw_event", listener);
        const event: WeComEvent = {
            MsgType: "event",
            Event: "enter_agent",
            CreateTime: 1_777_000_004,
            FromUserName: "u1",
        };

        const first = client.ingest(event);
        const retry = client.ingest(structuredClone(event));
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
        release();

        await expect(Promise.all([first, retry])).resolves.toEqual([
            expect.objectContaining({ accepted: 1, duplicate: false }),
            expect.objectContaining({ accepted: 1, duplicate: false }),
        ]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("不会把同秒发生的不同无 MsgId 事件误判为重复", async () => {
        const client = new WeComClient({ ...config, receive_mode: "manual" });
        const listener = vi.fn();
        client.on("raw_event", listener);
        const base: WeComEvent = {
            MsgType: "event",
            Event: "open_approval_change",
            CreateTime: 1_777_000_005,
            FromUserName: "sys",
        };

        const first = await client.ingest({ ...base, ApprovalInfo: { ThirdNo: "first" } });
        const second = await client.ingest({ ...base, ApprovalInfo: { ThirdNo: "second" } });

        expect(first.eventId).not.toBe(second.eventId);
        expect(second.duplicate).toBe(false);
        expect(listener).toHaveBeenCalledTimes(2);
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
