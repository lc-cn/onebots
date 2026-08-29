import { afterEach, describe, expect, it, vi } from "vitest";
import { DingTalkBot } from "./bot.js";
import { DingTalkCallbackCrypto } from "./crypto.js";

describe("DingTalkBot", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("群消息使用 openConversationId 的企业机器人 API", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ accessToken: "token", expireIn: 7200 }))
            .mockResolvedValueOnce(jsonResponse({ processQueryKey: "query_1" }));
        vi.stubGlobal("fetch", fetchMock);
        const bot = new DingTalkBot({
            account_id: "bot",
            app_key: "app-key",
            app_secret: "secret",
        });
        const result = await bot.sendMessage("cid_group", "group", {
            msgKey: "sampleText",
            msgParam: { content: "hello" },
            webhook: { msgtype: "text", text: { content: "hello" } },
        });

        expect(result).toEqual({ processQueryKey: "query_1" });
        const [url, request] = fetchMock.mock.calls[1] as [URL, RequestInit];
        expect(url.toString()).toBe("https://api.dingtalk.com/v1.0/robot/groupMessages/send");
        expect(request.headers).toMatchObject({ "x-acs-dingtalk-access-token": "token" });
        expect(JSON.parse(String(request.body))).toEqual({
            robotCode: "app-key",
            openConversationId: "cid_group",
            msgKey: "sampleText",
            msgParam: '{"content":"hello"}',
        });
    });

    it("HTTP 回调校验签名、解密事件并返回加密 success", async () => {
        const key = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
        const callbackCrypto = new DingTalkCallbackCrypto("token", key, "ding-corp");
        const incoming = callbackCrypto.encryptResponse(
            JSON.stringify({ EventType: "user_add_org", UserId: ["user_1"] }),
            "1710000000000",
            "nonce-1",
        );
        const bot = new DingTalkBot({
            account_id: "bot",
            receive_mode: "webhook",
            token: "token",
            encrypt_key: key,
            corp_id: "ding-corp",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        const ctx = {
            request: { body: { encrypt: incoming.encrypt } },
            query: {
                timestamp: incoming.timeStamp,
                nonce: incoming.nonce,
                msg_signature: incoming.msg_signature,
            },
            body: undefined,
            status: 200,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: "user_add_org" }),
            { encrypt: incoming.encrypt },
        );
        const response = ctx.body as unknown as ReturnType<
            DingTalkCallbackCrypto["encryptResponse"]
        >;
        expect(
            callbackCrypto.decrypt(
                response.encrypt,
                response.msg_signature,
                response.timeStamp,
                response.nonce,
            ),
        ).toBe("success");
    });
});

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}
