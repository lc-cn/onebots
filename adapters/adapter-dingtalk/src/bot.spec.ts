import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkBot } from "./bot.js";
import { DingTalkCallbackCrypto } from "./crypto.js";
import { DingTalkApiError, DingTalkError } from "./errors.js";

describe("DingTalkBot", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("manual 模式通过 ingest 复用同一机器人消息管线", async () => {
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

        await expect(bot.ingest(message)).resolves.toEqual(message);
        await expect(bot.ingest(message)).resolves.toEqual(message);
        expect(listener).toHaveBeenCalledWith(message, message);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(bot.getCachedMe()?.userid).toBe("bot-id");
    });

    it("异步业务处理失败不提交消息去重，重投成功后才抑制重复", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const listener = vi.fn().mockRejectedValueOnce(new Error("dispatch failed"));
        bot.on("robot_message", listener);
        const message = robotMessage("msg-retry");

        await expect(bot.ingest(message)).rejects.toThrow("dispatch failed");
        await expect(bot.ingest(message)).resolves.toEqual(message);
        await bot.ingest(message);

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("合并同一消息的并发重投并等待异步监听器", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        let release: (() => void) | undefined;
        const listener = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        bot.on("robot_message", listener);
        const message = robotMessage("msg-concurrent");

        const first = bot.ingest(message);
        const second = bot.ingest(message);
        expect(listener).toHaveBeenCalledOnce();
        release?.();
        await Promise.all([first, second]);
        expect(listener).toHaveBeenCalledOnce();
    });

    it("缺少原生 ID 的 Webhook 重投使用确定性载荷身份", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const listener = vi.fn();
        bot.on("event", listener);

        await bot.ingest({ EventType: "user_add_org", UserId: ["u1"], CorpId: "corp" });
        await bot.ingest({ CorpId: "corp", UserId: ["u1"], EventType: "user_add_org" });

        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]?.[0].eventId).toMatch(/^user_add_org:sha256:/u);
    });

    it("Webhook 业务处理失败返回 500 并允许上游重投", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "webhook" });
        const listener = vi.fn().mockImplementationOnce(() => {
            throw new Error("dispatch failed");
        });
        bot.on("robot_message", listener);
        bot.on("error", vi.fn());
        const message = robotMessage("msg-webhook-retry");
        const first = await bot.ingestHttp({ method: "POST", body: message });
        const second = await bot.ingestHttp({ method: "POST", body: message });

        expect(first.status).toBe(500);
        expect(second.body).toEqual({ success: true });
        expect(second.event).toEqual(message);
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
        const result = await bot.ingestHttp({
            method: "POST",
            body: { encrypt: incoming.encrypt },
            query: {
                timestamp: incoming.timeStamp,
                nonce: incoming.nonce,
                msg_signature: incoming.msg_signature,
            },
        });

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: "user_add_org" }),
            { encrypt: incoming.encrypt },
        );
        expect(result.status).toBe(200);
        const response = result.body as ReturnType<DingTalkCallbackCrypto["encryptResponse"]>;
        expect(
            callbackCrypto.decrypt(
                response.encrypt,
                response.msg_signature,
                response.timeStamp,
                response.nonce,
            ),
        ).toBe("success");
    });

    it("acceptHttp 接收标准 Request 并复用加密回调管线", async () => {
        const key = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
        const callbackCrypto = new DingTalkCallbackCrypto("token", key, "ding-corp");
        const incoming = callbackCrypto.encryptResponse(
            JSON.stringify({ EventType: "user_add_org", UserId: ["user_1"] }),
            "1710000000000",
            "nonce-1",
        );
        const bot = new DingTalkBot({
            account_id: "bot",
            receive_mode: "manual",
            token: "token",
            encrypt_key: key,
            corp_id: "ding-corp",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        const query = new URLSearchParams({
            timestamp: incoming.timeStamp,
            nonce: incoming.nonce,
            msg_signature: incoming.msg_signature,
        });

        const response = await bot.acceptHttp(
            new Request(`https://example.test/dingtalk?${query}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ encrypt: incoming.encrypt }),
            }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(listener).toHaveBeenCalledOnce();
        const body = (await response.json()) as ReturnType<
            DingTalkCallbackCrypto["encryptResponse"]
        >;
        expect(
            callbackCrypto.decrypt(body.encrypt, body.msg_signature, body.timeStamp, body.nonce),
        ).toBe("success");
    });

    it("acceptHttp 对方法、损坏 JSON 与 Koa Host 返回一致的结构化响应", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const rejected = await bot.acceptHttp(new Request("https://example.test/dingtalk"));
        expect(rejected.status).toBe(405);
        expect(rejected.headers.get("allow")).toBe("POST");

        const invalid = await bot.acceptHttp(
            new Request("https://example.test/dingtalk", { method: "POST", body: "{" }),
        );
        expect(invalid.status).toBe(400);
        await expect(invalid.json()).resolves.toMatchObject({
            code: "DINGTALK_CALLBACK_INVALID",
        });

        const headers = new Map<string, string>();
        const context = {
            method: "POST",
            query: {},
            request: { body: robotMessage("msg-koa") },
            status: 0,
            body: undefined,
            set: (name: string, value: string) => headers.set(name, value),
        };
        await bot.acceptHttp(context);
        expect(context.status).toBe(200);
        expect(context.body).toEqual({ success: true });
        expect(headers.get("Content-Type")).toContain("application/json");
    });

    it("一个监听器失败时仍尝试其他事件出口并允许上游重投", async () => {
        const bot = new DingTalkBot({ account_id: "bot", receive_mode: "manual" });
        const failed = vi.fn().mockRejectedValueOnce(new Error("first failed"));
        const delivered = vi.fn();
        bot.on("robot_message", failed);
        bot.on("robot_message", delivered);
        const message = robotMessage("msg-all-listeners");

        await expect(bot.ingest(message)).rejects.toThrow("first failed");
        expect(delivered).toHaveBeenCalledOnce();
        await expect(bot.ingest(message)).resolves.toEqual(message);
        expect(failed).toHaveBeenCalledTimes(2);
        expect(delivered).toHaveBeenCalledTimes(2);
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
