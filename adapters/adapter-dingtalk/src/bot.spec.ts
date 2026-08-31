import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkBot } from "./bot.js";
import { DingTalkCallbackCrypto } from "./crypto.js";
import { DingTalkApiError, DingTalkError } from "./errors.js";

describe("DingTalkBot", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("manual 模式通过 ingest 复用同一机器人消息管线", () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const listener = vi.fn();
        bot.on("robot_message", listener);
        const message = {
            conversationId: "cid",
            conversationType: "2",
            chatbotUserId: "bot-id",
            msgId: "msg-1",
            msgtype: "text",
            createAt: 1,
            senderId: "user-1",
            text: { content: "hello" },
        };

        expect(bot.ingest(message)).toEqual(message);
        expect(bot.ingest(message)).toEqual(message);
        expect(listener).toHaveBeenCalledWith(message, message);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(bot.getCachedMe()?.userid).toBe("bot-id");
    });

    it("业务处理失败不提交消息去重，重投成功后才抑制重复", () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const listener = vi.fn().mockImplementationOnce(() => {
            throw new Error("dispatch failed");
        });
        bot.on("robot_message", listener);
        const message = robotMessage("msg-retry");

        expect(() => bot.ingest(message)).toThrow("dispatch failed");
        expect(() => bot.ingest(message)).not.toThrow();
        bot.ingest(message);

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("Webhook 业务处理失败返回 500 并允许上游重投", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "webhook" });
        const listener = vi.fn().mockImplementationOnce(() => {
            throw new Error("dispatch failed");
        });
        bot.on("robot_message", listener);
        bot.on("error", vi.fn());
        const message = robotMessage("msg-webhook-retry");
        const first = { request: { body: message }, query: {}, body: undefined, status: 0 };
        const second = { request: { body: message }, query: {}, body: undefined, status: 0 };

        await bot.handleWebhook(first as never, vi.fn());
        await bot.handleWebhook(second as never, vi.fn());

        expect(first.status).toBe(500);
        expect(second.body).toEqual({ success: true });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("在创建传输前拒绝非法接收模式与 Stream 并发上限", () => {
        expect(
            () =>
                new DingTalkBot({
                    account_id: "bot",
                    receive_mode: "invalid" as never,
                }),
        ).toThrowError(expect.objectContaining({ code: "DINGTALK_RECEIVE_MODE_INVALID" }));
        expect(
            () =>
                new DingTalkBot({
                    account_id: "bot",
                    max_pending_event_handlers: 0,
                }),
        ).toThrowError(expect.objectContaining({ code: "DINGTALK_STREAM_CONCURRENCY_INVALID" }));
    });

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

    it("并发启动只刷新一次令牌并只发出一次 ready", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: "token" }));
        vi.stubGlobal("fetch", fetchMock);
        const bot = new DingTalkBot({
            account_id: "bot",
            receive_mode: "webhook",
            app_key: "app-key",
            app_secret: "secret",
        });
        const ready = vi.fn();
        bot.on("ready", ready);

        await Promise.all([bot.start(), bot.start()]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it("停止中的启动不会在异步令牌返回后重新上线", async () => {
        let release!: (response: Response) => void;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>(resolve => {
                        release = resolve;
                    }),
            ),
        );
        const bot = new DingTalkBot({
            account_id: "bot",
            receive_mode: "webhook",
            app_key: "app-key",
            app_secret: "secret",
        });
        const ready = vi.fn();
        bot.on("ready", ready);

        const starting = bot.start();
        await bot.stop();
        release(jsonResponse({ accessToken: "token" }));
        await starting;

        expect(ready).not.toHaveBeenCalled();
    });

    it("保留钉钉业务码、请求 ID 与稳定错误分类", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        code: "InvalidParameter",
                        message: "参数错误",
                        requestId: "r1",
                    }),
                    { status: 400 },
                ),
            ),
        );
        const bot = new DingTalkBot({ account_id: "bot" });

        const error = await bot
            .callApi("/v1.0/test", { auth: "none" })
            .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DingTalkApiError);
        expect(error).toMatchObject({
            code: "DINGTALK_INVALIDPARAMETER",
            category: ErrorCategory.VALIDATION,
            status: 400,
            platformCode: "InvalidParameter",
            requestId: "r1",
            path: "/v1.0/test",
        });
    });

    it("网络失败统一投影为可判断的钉钉错误", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
        const bot = new DingTalkBot({ account_id: "bot" });

        const error = await bot
            .callApi("/v1.0/test", { auth: "none" })
            .catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DingTalkError);
        expect(error).toMatchObject({
            code: "DINGTALK_NETWORK_ERROR",
            category: ErrorCategory.NETWORK,
        });
    });
});

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function robotMessage(msgId: string) {
    return {
        conversationId: "cid",
        conversationType: "2",
        chatbotUserId: "bot-id",
        msgId,
        msgtype: "text",
        createAt: 1,
        senderId: "user-1",
        text: { content: "hello" },
    };
}
