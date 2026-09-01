import { afterEach, describe, expect, it, vi } from "vitest";
import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import { ErrorCategory, OneBotsError } from "onebots";
import { TeamsBot } from "./bot.js";
import { allowedServiceUrlHosts } from "./bot-utils.js";
import { TeamsApiError, TeamsConversationReferenceError } from "./errors.js";
import type { TeamsConversationReference } from "./types.js";

describe("TeamsBot 会话引用契约", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("只接受 HTTPS Connector 地址", () => {
        expect(allowedServiceUrlHosts(["https://connector.example.com/path"])).toEqual([
            "connector.example.com",
        ]);
        expect(() => allowedServiceUrlHosts(["http://connector.example.com"])).toThrow(
            /HTTPS URL/u,
        );
    });

    it("缺少真实引用时明确拒绝主动发送", async () => {
        const bot = createBot();
        await expect(bot.withConversation("unknown", async () => undefined)).rejects.toBeInstanceOf(
            TeamsConversationReferenceError,
        );
    });

    it("原生流式 Activity 接受 Connector 的空中间响应", async () => {
        const bot = createBot();
        const sendActivity = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(bot, "withConversation").mockImplementation(async (_conversationId, logic) =>
            logic({ turn: { sendActivity } } as never),
        );
        const activity = Activity.fromObject({
            type: "typing",
            text: "正在检索…",
            entities: [{ type: "streaminfo", streamType: "informative", streamSequence: 1 }],
        });

        await expect(bot.sendRawActivity("c1", activity)).resolves.toBeUndefined();
        await expect(bot.sendActivity("c1", activity)).rejects.toMatchObject({
            code: "TEAMS_EMPTY_RESPONSE",
        });
    });

    it("允许导入并隔离返回的可信引用", () => {
        const bot = createBot();
        const reference: TeamsConversationReference = {
            conversation: { id: "c1", name: "General", isGroup: true },
            channelId: "msteams",
            serviceUrl: "https://smba.trafficmanager.net/teams/",
            agent: { id: "bot-channel-id", name: "Agent" },
        };
        bot.registerConversationReference(reference);
        const result = bot.getConversationReference("c1");
        expect(result).toEqual(reference);
        if (result) result.conversation.name = "changed";
        expect(bot.getConversationReference("c1")?.conversation.name).toBe("General");
    });

    it("拒绝非 HTTPS 的外部会话引用", () => {
        const bot = createBot();
        expect(() =>
            bot.registerConversationReference({
                conversation: { id: "c1" },
                channelId: "msteams",
                serviceUrl: "http://127.0.0.1/internal",
            }),
        ).toThrow(/HTTPS/u);
    });

    it("初始化时拒绝非 HTTPS 的 Graph 与 Entra 端点", () => {
        expect(() => createBot({ graph_base_url: "http://127.0.0.1/v1.0" })).toThrow(
            /graph_base_url.*HTTPS/u,
        );
        expect(() => createBot({ authority_endpoint: "http://127.0.0.1" })).toThrow(
            /authority_endpoint.*HTTPS/u,
        );
    });

    it("生命周期启动与停止保持幂等", async () => {
        const bot = createBot();
        const ready = vi.fn();
        const stopped = vi.fn();
        bot.on("ready", ready);
        bot.on("stopped", stopped);

        await bot.start();
        await bot.start();
        await bot.stop();
        await bot.stop();

        expect(ready).toHaveBeenCalledOnce();
        expect(stopped).toHaveBeenCalledOnce();
    });

    it("等待异步生命周期监听器完成", async () => {
        const bot = createBot();
        let releaseReady!: () => void;
        let releaseStopped!: () => void;
        bot.on("ready", () => new Promise<void>(resolve => (releaseReady = resolve)));
        bot.on("stopped", () => new Promise<void>(resolve => (releaseStopped = resolve)));

        let started = false;
        const start = bot.start().then(() => (started = true));
        await Promise.resolve();
        expect(started).toBe(false);
        releaseReady();
        await start;

        let stopped = false;
        const stop = bot.stop().then(() => (stopped = true));
        await Promise.resolve();
        expect(stopped).toBe(false);
        releaseStopped();
        await stop;
    });

    it("ready 监听器失败后允许重新启动", async () => {
        const bot = createBot();
        const failure = vi.fn().mockRejectedValue(new Error("projection unavailable"));
        bot.on("ready", failure);

        await expect(bot.start()).rejects.toThrow("projection unavailable");
        bot.off("ready", failure);
        const recovered = vi.fn(async () => undefined);
        bot.on("ready", recovered);

        await expect(bot.start()).resolves.toBeUndefined();
        expect(recovered).toHaveBeenCalledOnce();
    });

    it("账号取消后拒绝迟到完成的启动任务", async () => {
        const bot = createBot();
        const controller = new AbortController();
        let releaseReady!: () => void;
        bot.on("ready", () => new Promise<void>(resolve => (releaseReady = resolve)));

        const starting = bot.start(controller.signal);
        await Promise.resolve();
        controller.abort(new Error("account startup timed out"));
        releaseReady();

        await expect(starting).rejects.toMatchObject({ code: "TEAMS_START_CANCELLED" });
    });

    it("停止中的旧启动任务不能覆盖后续启动状态", async () => {
        const bot = createBot();
        let releaseReady!: () => void;
        const delayedReady = () => new Promise<void>(resolve => (releaseReady = resolve));
        bot.on("ready", delayedReady);

        const staleStart = bot.start();
        await Promise.resolve();
        await bot.stop();
        bot.off("ready", delayedReady);
        await expect(bot.start()).resolves.toBeUndefined();
        releaseReady();

        await expect(staleStart).rejects.toMatchObject({ code: "TEAMS_START_CANCELLED" });
        await expect(bot.start()).resolves.toBeUndefined();
    });

    it("公开 ingest 汇入同一管线并去重 canonical Activity", async () => {
        const bot = createBot();
        const message = vi.fn();
        const rawActivity = vi.fn();
        bot.on("private_message", message);
        bot.on("raw_activity", rawActivity);
        const activity = createActivity();

        await expect(bot.ingest(activity)).resolves.toMatchObject({ type: ActivityTypes.Message });
        await expect(bot.ingest(activity)).resolves.toBeUndefined();
        expect(rawActivity).toHaveBeenCalledTimes(2);
        expect(message).toHaveBeenCalledOnce();
        expect(bot.getCachedMe()).toMatchObject({ id: "bot-1", name: "Agent" });
    });

    it("异步 canonical 派发失败时不提交去重窗口", async () => {
        const bot = createBot();
        const failing = vi.fn().mockRejectedValue(new Error("consumer failed"));
        const activity = createActivity();
        bot.on("private_message", failing);

        await expect(bot.ingest(activity)).rejects.toThrow("consumer failed");
        bot.off("private_message", failing);
        const recovered = vi.fn();
        bot.on("private_message", recovered);
        await expect(bot.ingest(activity)).resolves.toBeDefined();
        expect(recovered).toHaveBeenCalledOnce();
    });

    it("逐个派发同一 Activity 中的原生 Reaction", async () => {
        const bot = createBot();
        const reaction = vi.fn();
        bot.on("reaction_added", reaction);
        const activity = createActivity();
        activity.type = ActivityTypes.MessageReaction;
        activity.reactionsAdded = [{ type: "like" }, { type: "heart" }];

        await bot.ingest(activity);

        expect(reaction).toHaveBeenCalledTimes(2);
        expect(
            reaction.mock.calls.map(([event]) => event.activity.reactionsAdded?.[0]?.type),
        ).toEqual(["like", "heart"]);
    });

    it("合并同一 Activity 的并发重投并等待异步消费者", async () => {
        const bot = createBot();
        let release: (() => void) | undefined;
        const message = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        bot.on("private_message", message);
        const activity = createActivity();

        const first = bot.ingest(activity);
        const second = bot.ingest(activity);
        await Promise.resolve();
        expect(message).toHaveBeenCalledOnce();
        release?.();
        await expect(Promise.all([first, second])).resolves.toEqual([
            expect.objectContaining({ activity: expect.objectContaining({ id: "activity-1" }) }),
            undefined,
        ]);
        expect(message).toHaveBeenCalledOnce();
    });

    it("缺少 Activity ID 与时间时按稳定载荷生成身份", async () => {
        const bot = createBot();
        const message = vi.fn();
        bot.on("private_message", message);
        const first = createActivity();
        first.id = undefined;
        first.timestamp = undefined;
        const retry = createActivity();
        retry.id = undefined;
        retry.timestamp = undefined;

        const projected = await bot.ingest(first);
        await bot.ingest(retry);

        expect(projected?.activity.id).toMatch(/^message:sha256:[a-f0-9]{64}$/u);
        expect(projected?.activity.timestamp).toBe("");
        expect(message).toHaveBeenCalledOnce();
    });

    it("Adaptive Card Action.Execute 默认返回合规 Invoke 响应", async () => {
        const bot = createBot();
        const activity = createActivity();
        activity.type = ActivityTypes.Invoke;
        activity.name = "adaptiveCard/action";
        activity.value = { action: { type: "Action.Execute", verb: "approve" } };
        const sendActivity = vi.fn().mockResolvedValue({ id: "" });

        await bot["handleTurn"]({ activity, sendActivity } as never);

        expect(sendActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                type: ActivityTypes.InvokeResponse,
                value: {
                    status: 200,
                    body: {
                        statusCode: 200,
                        type: "application/vnd.microsoft.activity.message",
                        value: "操作已接收",
                    },
                },
            }),
        );
    });

    it("自定义 Invoke 处理器的成功响应按 Activity ID 缓存", async () => {
        const bot = createBot();
        const handler = vi.fn().mockResolvedValue({ status: 200, body: { task: "ok" } });
        bot.setInvokeHandler(handler);
        const activity = createActivity();
        activity.type = ActivityTypes.Invoke;
        activity.name = "task/fetch";
        const sendActivity = vi.fn().mockResolvedValue({ id: "" });
        const context = { activity, sendActivity } as never;

        await bot["handleTurn"](context);
        await bot["handleTurn"](context);

        expect(handler).toHaveBeenCalledOnce();
        expect(sendActivity).toHaveBeenCalledTimes(2);
    });

    it("Webhook 对非法 Activity 返回结构化 400", async () => {
        const bot = createBot();
        const clientError = vi.fn();
        bot.on("client_error", clientError);
        const context = {
            method: "POST",
            headers: {},
            request: { body: [] },
            status: 200,
            body: undefined,
            set: vi.fn(),
        };

        await bot.handleWebhook(context as never, vi.fn());

        expect(context.status).toBe(400);
        expect(context.body).toEqual({
            error: {
                code: "TEAMS_ACTIVITY_INVALID",
                message: "Teams Activity 请求体必须是对象",
            },
        });
        expect(clientError).toHaveBeenCalledWith(expect.any(TeamsApiError));
        const error = clientError.mock.calls[0]?.[0];
        expect(error).toBeInstanceOf(OneBotsError);
        expect(error).toMatchObject({ category: ErrorCategory.VALIDATION });
    });

    it("ingestHttp 拒绝非 POST 并返回可移植的结构化响应", async () => {
        const bot = createBot();

        await expect(bot.ingestHttp({ method: "GET", body: {} })).resolves.toEqual({
            status: 405,
            headers: {},
            body: {
                error: {
                    code: "TEAMS_WEBHOOK_METHOD_NOT_ALLOWED",
                    message: "Teams Activity 入口只接受 POST",
                },
            },
        });
    });

    it("acceptHttp 接受标准 Request 并返回标准 Response", async () => {
        const bot = createBot();
        const response = await bot.acceptHttp(
            new Request("https://example.com/teams", { method: "GET" }),
        );

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(405);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "TEAMS_WEBHOOK_METHOD_NOT_ALLOWED" },
        });
    });

    it("acceptHttp 对无效 JSON 返回结构化错误", async () => {
        const bot = createBot();
        const response = await bot.acceptHttp(
            new Request("https://example.com/teams", { method: "POST", body: "{" }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "TEAMS_WEBHOOK_INVALID_JSON" },
        });
    });
});

function createBot(overrides: Partial<ConstructorParameters<typeof TeamsBot>[0]> = {}): TeamsBot {
    const references = new Map<string, TeamsConversationReference>();
    return new TeamsBot(
        {
            account_id: "test",
            app_id: "00000000-0000-0000-0000-000000000000",
            app_password: "secret",
            tenant_id: "organizations",
            ...overrides,
        },
        {
            get: id => references.get(id),
            list: () => [...references.values()],
            save: reference => references.set(reference.conversation.id, reference),
            saveMessage: () => undefined,
        },
    );
}

function createActivity(): Activity {
    const activity = new Activity(ActivityTypes.Message);
    activity.id = "activity-1";
    activity.timestamp = new Date("2026-08-30T00:00:00.000Z");
    activity.serviceUrl = "https://smba.trafficmanager.net/teams/";
    activity.channelId = "msteams";
    activity.from = { id: "user-1", name: "Ada" };
    activity.recipient = { id: "bot-1", name: "Agent" };
    activity.conversation = { id: "conversation-1", isGroup: false };
    activity.text = "hello";
    return activity;
}
