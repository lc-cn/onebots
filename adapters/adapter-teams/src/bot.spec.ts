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

    it("按 Teams 文件 consent 协议上传真实字节", async () => {
        const request = vi.fn().mockResolvedValue(
            new Response(null, {
                status: 201,
                headers: { etag: '"file-etag"' },
            }),
        );
        vi.stubGlobal("fetch", request);
        const bot = createBot();

        await expect(
            bot.uploadFileConsentContent("https://upload.example.com/session?token=secret", {
                source: "base64://aGVsbG8=",
                filename: "hello.txt",
                contentType: "text/plain",
            }),
        ).resolves.toEqual({ status: 201, etag: '"file-etag"' });
        expect(request).toHaveBeenCalledWith(
            new URL("https://upload.example.com/session?token=secret"),
            expect.objectContaining({
                method: "PUT",
                headers: {
                    "content-type": "application/octet-stream",
                    "content-length": "5",
                    "content-range": "bytes 0-4/5",
                },
                body: Buffer.from("hello"),
            }),
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

    it("公开 ingest 汇入同一管线并去重 canonical Activity", () => {
        const bot = createBot();
        const message = vi.fn();
        const rawActivity = vi.fn();
        bot.on("private_message", message);
        bot.on("raw_activity", rawActivity);
        const activity = createActivity();

        expect(bot.ingest(activity)).toMatchObject({ type: ActivityTypes.Message });
        expect(bot.ingest(activity)).toBeUndefined();
        expect(rawActivity).toHaveBeenCalledTimes(2);
        expect(message).toHaveBeenCalledOnce();
    });

    it("逐个派发同一 Activity 中的原生 Reaction", () => {
        const bot = createBot();
        const reaction = vi.fn();
        bot.on("reaction_added", reaction);
        const activity = createActivity();
        activity.type = ActivityTypes.MessageReaction;
        activity.reactionsAdded = [{ type: "like" }, { type: "heart" }];

        bot.ingest(activity);

        expect(reaction).toHaveBeenCalledTimes(2);
        expect(
            reaction.mock.calls.map(([event]) => event.activity.reactionsAdded?.[0]?.type),
        ).toEqual(["like", "heart"]);
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
