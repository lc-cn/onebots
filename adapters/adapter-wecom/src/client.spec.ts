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

    it("拒绝危险 API 路径和非数字 AgentID", async () => {
        const client = new WeComClient(config);
        await expect(client.call({ path: "https://evil.example" })).rejects.toMatchObject({
            code: "WECOM_INVALID_API_PATH",
        });
        expect(() => new WeComClient({ ...config, agent_id: "app" })).toThrowError(
            expect.objectContaining({ code: "WECOM_INVALID_AGENT_ID" }),
        );
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
            FromUserName: "u1",
            Content: "hi",
        };
        client.ingest(event);
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledWith(event);
    });
});
