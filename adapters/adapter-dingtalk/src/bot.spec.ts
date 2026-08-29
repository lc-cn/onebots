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

    it("递归读取可见部门、完成分页并去重用户", async () => {
        const tokenRequests: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
                const url = new URL(String(input));
                const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
                if (url.pathname === "/v1.0/oauth2/accessToken") {
                    tokenRequests.push(url.pathname);
                    return jsonResponse({ accessToken: "token", expireIn: 7200 });
                }
                if (url.pathname === "/topapi/v2/department/listsub") {
                    return jsonResponse({
                        errcode: 0,
                        errmsg: "ok",
                        result: body.dept_id === 1 ? [{ dept_id: 2 }] : [],
                    });
                }
                if (url.pathname === "/topapi/v2/user/list") {
                    if (body.dept_id === 1 && body.cursor === 0) {
                        return jsonResponse({
                            errcode: 0,
                            errmsg: "ok",
                            result: {
                                list: [{ userid: "u1", name: "甲" }],
                                has_more: true,
                                next_cursor: 100,
                            },
                        });
                    }
                    if (body.dept_id === 1) {
                        return jsonResponse({
                            errcode: 0,
                            errmsg: "ok",
                            result: { list: [{ userid: "u2", name: "乙" }] },
                        });
                    }
                    return jsonResponse({
                        errcode: 0,
                        errmsg: "ok",
                        result: { list: [{ userid: "u2", name: "乙（重复）" }] },
                    });
                }
                throw new Error(`未处理的测试请求: ${url.pathname}`);
            }),
        );
        const bot = new DingTalkBot({
            account_id: "bot",
            app_key: "app-key",
            app_secret: "secret",
        });

        await expect(bot.getVisibleUsers()).resolves.toEqual([
            { userid: "u1", name: "甲" },
            { userid: "u2", name: "乙（重复）" },
        ]);
        expect(tokenRequests).toHaveLength(1);
    });

    it("完整读取场景群成员分页和群昵称", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ accessToken: "token", expireIn: 7200 }))
            .mockResolvedValueOnce(
                jsonResponse({
                    result: {
                        member_user_ids: ["u1"],
                        staff_id_nick_map: '{"u1":"群昵称甲"}',
                        has_more: true,
                        next_cursor: "next",
                    },
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    result: {
                        member_user_ids: ["u2"],
                        staff_id_nick_map: { u2: "群昵称乙" },
                    },
                }),
            );
        vi.stubGlobal("fetch", fetchMock);
        const bot = new DingTalkBot({
            account_id: "bot",
            app_key: "app-key",
            app_secret: "secret",
        });

        await expect(bot.getSceneGroupMembers("cid_group")).resolves.toEqual([
            { userId: "u1", nickname: "群昵称甲" },
            { userId: "u2", nickname: "群昵称乙" },
        ]);
        const [, secondPageRequest] = fetchMock.mock.calls[2] as [URL, RequestInit];
        expect(JSON.parse(String(secondPageRequest.body))).toMatchObject({ cursor: "next" });
    });
});

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}
