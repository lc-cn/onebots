import { describe, expect, it, vi } from "vitest";
import { WechatClient } from "./client.js";
import type { WechatConfig, WechatIncomingMessage } from "./types.js";

const config: WechatConfig = {
    account_id: "bot",
    app_id: "wx-app",
    app_secret: "secret",
    token: "token",
};

const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    });

describe("WechatClient", () => {
    it("缓存 token，并在微信报告 token 失效时刷新且只重试一次", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(json({ access_token: "old", expires_in: 7200 }))
            .mockResolvedValueOnce(json({ errcode: 40014, errmsg: "invalid token" }))
            .mockResolvedValueOnce(json({ access_token: "new", expires_in: 7200 }))
            .mockResolvedValueOnce(json({ openid: "user", subscribe: 1 }));
        const client = new WechatClient(config, fetcher);
        await expect(client.getUserInfo("user")).resolves.toMatchObject({ openid: "user" });
        expect(fetcher).toHaveBeenCalledTimes(4);
        expect(String(fetcher.mock.calls[3]?.[0])).toContain("access_token=new");
    });

    it("拒绝绝对 URL 和路径穿越", async () => {
        const client = new WechatClient(config);
        await expect(client.call({ path: "https://evil.example/token" })).rejects.toMatchObject({
            code: "WECHAT_INVALID_API_PATH",
        });
        await expect(client.call({ path: "/cgi-bin/../token" })).rejects.toMatchObject({
            code: "WECHAT_INVALID_API_PATH",
        });
    });

    it("保留可注入 API Base URL 的路径前缀", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(json({ access_token: "token", expires_in: 7200 }));
        const client = new WechatClient(
            { ...config, api_base_url: "https://proxy.example/wechat" },
            fetcher,
        );
        await client.getAccessToken();
        expect(String(fetcher.mock.calls[0]?.[0])).toContain(
            "https://proxy.example/wechat/cgi-bin/token",
        );
    });

    it("标准发送始终以适配器解析出的 openid 为目标", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(json({ access_token: "token", expires_in: 7200 }))
            .mockResolvedValueOnce(json({ errcode: 0, errmsg: "ok" }));
        const client = new WechatClient(config, fetcher);
        await client.sendCustomMessage("resolved-user", {
            msgtype: "text",
            touser: "forged-user",
            text: { content: "hello" },
        });
        expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
            touser: "resolved-user",
        });
    });

    it("从统一 ingest 分发事件并按事件 ID 接收被动回复", async () => {
        const client = new WechatClient(config);
        const raw = vi.fn();
        const messageListener = vi.fn();
        client.on("raw_event", raw);
        client.on("message", messageListener);
        const message: WechatIncomingMessage = {
            ToUserName: "bot",
            FromUserName: "user",
            CreateTime: 1,
            MsgType: "text",
            MsgId: "m1",
            Content: "hi",
        };
        const result = client.ingest(message, { passiveReplyTimeoutMs: 100 });
        expect(client.hasPendingPassiveReply("m1")).toBe(true);
        expect(client.submitPassiveReply("m1", { msgtype: "text", text: { content: "ok" } })).toBe(
            true,
        );
        await expect(result).resolves.toEqual({ msgtype: "text", text: { content: "ok" } });
        expect(client.hasPendingPassiveReply("m1")).toBe(false);
        expect(raw).toHaveBeenCalledWith(message);
        expect(messageListener).toHaveBeenCalledWith(message);
    });

    it("ingest 拒绝无法稳定投影的外部消息", async () => {
        const client = new WechatClient(config);
        await expect(
            client.ingest({
                ToUserName: "bot",
                FromUserName: "user",
                CreateTime: 1,
                MsgType: "text",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_EVENT" });
    });
});
