import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipHttpRequest, ZulipTransport } from "./http.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("ZulipClient", () => {
    it("使用官方 register/events 长轮询并在 stop 时删除队列", async () => {
        const requests: ZulipHttpRequest[] = [];
        const transport: ZulipTransport = request => {
            requests.push(request);
            if (request.path === "users/me") return Promise.resolve(user());
            if (request.path === "register") {
                return Promise.resolve({
                    result: "success",
                    msg: "",
                    queue_id: "queue-1",
                    last_event_id: -1,
                    event_queue_longpoll_timeout_seconds: 30,
                });
            }
            if (request.path === "events" && request.method === "GET") {
                return new Promise((_, reject) => {
                    request.signal?.addEventListener(
                        "abort",
                        () => reject(request.signal?.reason),
                        { once: true },
                    );
                });
            }
            return Promise.resolve({ result: "success", msg: "" });
        };
        const client = new ZulipClient(config, { transport });

        await client.start();
        await vi.waitFor(() => expect(requests.some(item => item.path === "events")).toBe(true));
        await client.stop();

        expect(requests.map(item => `${item.method} ${item.path}`)).toContain("POST register");
        expect(requests.map(item => `${item.method} ${item.path}`)).toContain("DELETE events");
        expect(
            requests.find(item => item.path === "events" && item.method === "GET")?.timeoutMs,
        ).toBe(40_000);
    });

    it("删除事件队列失败时仍完成本地停止并传播结构化错误", async () => {
        const transport: ZulipTransport = request => {
            if (request.path === "users/me") return Promise.resolve(user());
            if (request.path === "register") {
                return Promise.resolve({
                    result: "success",
                    msg: "",
                    queue_id: "queue-1",
                    last_event_id: -1,
                });
            }
            if (request.path === "events" && request.method === "GET") {
                return new Promise((_, reject) =>
                    request.signal?.addEventListener(
                        "abort",
                        () => reject(request.signal?.reason),
                        {
                            once: true,
                        },
                    ),
                );
            }
            if (request.path === "events" && request.method === "DELETE") {
                return Promise.reject(new Error("delete failed"));
            }
            return Promise.resolve({ result: "success", msg: "" });
        };
        const client = new ZulipClient(config, { transport });
        const clientError = vi.fn();
        const stopped = vi.fn();
        client.on("client_error", clientError);
        client.on("stop", stopped);

        await client.start();
        await expect(client.stop()).rejects.toMatchObject({ code: "ZULIP_QUEUE_DELETE_FAILED" });
        expect(stopped).toHaveBeenCalledOnce();
        expect((client as unknown as { started: boolean }).started).toBe(false);
        expect(clientError).toHaveBeenCalledWith(
            expect.objectContaining({ code: "ZULIP_QUEUE_DELETE_FAILED" }),
        );
    });

    it("队列被回收后无限恢复并创建新 generation", async () => {
        let registrations = 0;
        let eventCalls = 0;
        const transport: ZulipTransport = request => {
            if (request.path === "users/me") return Promise.resolve(user());
            if (request.path === "register") {
                registrations += 1;
                return Promise.resolve({
                    result: "success",
                    msg: "",
                    queue_id: `queue-${registrations}`,
                    last_event_id: -1,
                });
            }
            if (request.path === "events" && request.method === "GET") {
                eventCalls += 1;
                if (eventCalls === 1) {
                    return Promise.reject(
                        new ZulipError("queue expired", { code: "BAD_EVENT_QUEUE_ID" }),
                    );
                }
                return new Promise((_, reject) => {
                    request.signal?.addEventListener(
                        "abort",
                        () => reject(request.signal?.reason),
                        {
                            once: true,
                        },
                    );
                });
            }
            return Promise.resolve({ result: "success", msg: "" });
        };
        const client = new ZulipClient(config, {
            transport,
            sleep: () => Promise.resolve(),
        });
        const errors: ZulipError[] = [];
        client.on("client_error", error => errors.push(error));

        await client.start();
        await vi.waitFor(() => expect(registrations).toBe(2));
        expect(errors[0]?.code).toBe("BAD_EVENT_QUEUE_ID");
        await client.stop();
    });

    it("监听器异常时不提交事件，重投成功后才去重", async () => {
        const client = new ZulipClient(
            { ...config, receive_mode: "manual" },
            { transport: async () => ({}) },
        );
        let attempts = 0;
        const messageSeen = vi.fn(() => {
            attempts += 1;
            if (attempts === 1) throw new Error("listener failed");
        });
        const eventSeen = vi.fn();
        client.on("message", messageSeen);
        client.on("event", eventSeen);

        const event = { id: 1, type: "message", message: message() } as const;
        await expect(client.ingest(event)).rejects.toThrow("listener failed");
        await expect(client.ingest(event)).resolves.toBe(true);
        await expect(client.ingest(event)).resolves.toBe(false);

        expect(messageSeen).toHaveBeenCalledTimes(2);
        expect(eventSeen).toHaveBeenCalledTimes(2);
    });

    it("队列仅在事件投递成功后推进游标", async () => {
        const eventRequests: ZulipHttpRequest[] = [];
        let eventCalls = 0;
        const transport: ZulipTransport = request => {
            if (request.path === "users/me") return Promise.resolve(user());
            if (request.path === "register") {
                return Promise.resolve({
                    result: "success",
                    msg: "",
                    queue_id: "queue-1",
                    last_event_id: -1,
                });
            }
            if (request.path === "events" && request.method === "GET") {
                eventRequests.push(request);
                eventCalls += 1;
                if (eventCalls === 1) {
                    return Promise.resolve({
                        result: "success",
                        msg: "",
                        events: [
                            { id: 1, type: "heartbeat" },
                            { id: 2, type: "message", message: message() },
                        ],
                    });
                }
                if (eventCalls === 2) {
                    return Promise.resolve({
                        result: "success",
                        msg: "",
                        events: [{ id: 2, type: "message", message: message() }],
                    });
                }
                return new Promise((_, reject) =>
                    request.signal?.addEventListener(
                        "abort",
                        () => reject(request.signal?.reason),
                        {
                            once: true,
                        },
                    ),
                );
            }
            return Promise.resolve({ result: "success", msg: "" });
        };
        const client = new ZulipClient(config, {
            transport,
            sleep: () => Promise.resolve(),
        });
        let messageAttempts = 0;
        client.on("message", () => {
            messageAttempts += 1;
            if (messageAttempts === 1) throw new Error("temporary failure");
        });

        await client.start();
        await vi.waitFor(() => expect(eventRequests).toHaveLength(3));

        expect(eventRequests[1]?.params?.last_event_id).toBe(1);
        expect(eventRequests[2]?.params?.last_event_id).toBe(2);
        expect(messageAttempts).toBe(2);
        await client.stop();
    });

    it("manual 模式只认证身份，不注册队列并缓存认证结果", async () => {
        const requests: ZulipHttpRequest[] = [];
        const client = new ZulipClient(
            { ...config, receive_mode: "manual" },
            {
                transport: async request => {
                    requests.push(request);
                    return user();
                },
            },
        );

        await client.start();

        expect(requests.map(request => request.path)).toEqual(["users/me"]);
        expect(client.getCachedMe()).toEqual(user());
        await client.stop();
        expect(client.getCachedMe()).toBeUndefined();
    });

    it("快速重启时旧 stop 不会清除新 generation 的轮询引用", async () => {
        const client = new ZulipClient(
            { ...config, receive_mode: "manual" },
            { transport: async () => user() },
        );
        let resolveOldPoll: (() => void) | undefined;
        const oldPoll = new Promise<void>(resolve => {
            resolveOldPoll = resolve;
        });
        const newPoll = Promise.resolve();
        const lifecycle = client as unknown as {
            started: boolean;
            pollRequest?: Promise<void>;
        };
        lifecycle.started = true;
        lifecycle.pollRequest = oldPoll;

        const stopping = client.stop();
        lifecycle.pollRequest = newPoll;
        resolveOldPoll?.();
        await stopping;

        expect(lifecycle.pollRequest).toBe(newPoll);
    });

    it("空事件选择回落到默认订阅，并投递官方命名事件", async () => {
        const requests: ZulipHttpRequest[] = [];
        const transport: ZulipTransport = request => {
            requests.push(request);
            if (request.path === "users/me") return Promise.resolve(user());
            if (request.path === "register") {
                return Promise.resolve({
                    result: "success",
                    msg: "",
                    queue_id: "queue-1",
                    last_event_id: -1,
                });
            }
            if (request.path === "events" && request.method === "GET") {
                return new Promise((_, reject) =>
                    request.signal?.addEventListener(
                        "abort",
                        () => reject(request.signal?.reason),
                        {
                            once: true,
                        },
                    ),
                );
            }
            return Promise.resolve({ result: "success", msg: "" });
        };
        const client = new ZulipClient(
            { ...config, event_queue: { event_types: [] } },
            { transport },
        );
        const subscription = vi.fn();
        const attachment = vi.fn();
        const channelFolder = vi.fn();
        const navigationView = vi.fn();
        const messageFlags = vi.fn();
        client.on("subscription", subscription);
        client.on("attachment", attachment);
        client.on("channel_folder", channelFolder);
        client.on("navigation_view", navigationView);
        client.on("update_message_flags", messageFlags);

        await client.start();
        const registration = requests.find(request => request.path === "register");
        expect(registration?.params?.event_types).toContain("message");
        expect(registration?.params?.event_types).toContain("attachment");
        expect(registration?.params?.event_types).toContain("channel_folder");
        expect(registration?.params?.event_types).toContain("navigation_view");
        expect(registration?.params?.event_types).toContain("update_message_flags");
        expect(registration?.params?.event_types).toContain("scheduled_messages");
        expect(registration?.params?.event_types).toContain("reminders");
        expect(registration?.params?.event_types).toContain("heartbeat");
        expect(registration?.params?.event_types).toContain("restart");
        expect(registration?.params?.event_types).toContain("user_group");
        expect(registration?.params?.event_types).toContain("invites_changed");
        expect(registration?.params?.event_types).toContain("alert_words");
        expect(registration?.params?.event_types).toContain("muted_users");
        expect(registration?.params?.event_types).toContain("custom_profile_fields");
        expect(registration?.params?.event_types).toContain("realm_domains");
        expect(registration?.params?.event_types).toContain("realm_emoji");
        expect(registration?.params?.event_types).toContain("realm_linkifiers");
        expect(registration?.params?.event_types).toContain("realm_playgrounds");
        expect(registration?.params?.event_types).toContain("realm_export");
        expect(registration?.params?.event_types).toContain("realm_export_consent");
        expect(registration?.params?.client_capabilities).toMatchObject({
            include_deactivated_groups: true,
            individual_emoji_changes: true,
            linkifier_url_template: true,
        });
        await client.ingest({ id: 2, type: "subscription", op: "add" });
        await client.ingest({
            id: 5,
            type: "attachment",
            op: "remove",
            attachment: { id: 7 },
            upload_space_used: 0,
        });
        await client.ingest({
            id: 3,
            type: "channel_folder",
            op: "update",
            channel_folder_id: 2,
            data: { name: "Platform" },
        });
        await client.ingest({
            id: 4,
            type: "navigation_view",
            op: "remove",
            fragment: "narrow/is/alerted",
        });
        await client.ingest({
            id: 6,
            type: "update_message_flags",
            op: "add",
            flag: "starred",
            messages: [42],
            all: false,
        });
        expect(subscription).toHaveBeenCalledOnce();
        expect(attachment).toHaveBeenCalledWith(
            expect.objectContaining({ op: "remove", attachment: { id: 7 } }),
        );
        expect(channelFolder).toHaveBeenCalledWith(
            expect.objectContaining({ op: "update", channel_folder_id: 2 }),
        );
        expect(navigationView).toHaveBeenCalledWith(
            expect.objectContaining({ op: "remove", fragment: "narrow/is/alerted" }),
        );
        expect(messageFlags).toHaveBeenCalledWith(
            expect.objectContaining({ op: "add", flag: "starred", messages: [42] }),
        );
        await client.stop();
    });

    it("上传文件使用受控 multipart 请求", async () => {
        const transport = vi.fn<ZulipTransport>().mockResolvedValue({
            result: "success",
            msg: "",
            url: "/user_uploads/a.txt",
        });
        const client = new ZulipClient(config, { transport });

        const result = await client.upload(Buffer.from("hello"), "a.txt", "text/plain");

        expect(result.url).toBe("/user_uploads/a.txt");
        expect(transport).toHaveBeenCalledWith(
            expect.objectContaining({
                method: "POST",
                path: "user_uploads",
                body: expect.any(Buffer),
                contentType: expect.stringContaining("multipart/form-data"),
            }),
        );
    });

    it("自定义表情复用受控 multipart 并编码资源名", async () => {
        const transport = vi.fn<ZulipTransport>().mockResolvedValue({
            result: "success",
            msg: "",
        });
        const client = new ZulipClient(config, { transport });

        await client.uploadCustomEmoji(
            "release ready",
            Buffer.from("png"),
            "ready.png",
            "image/png",
        );

        expect(transport).toHaveBeenCalledWith(
            expect.objectContaining({
                method: "POST",
                path: "realm/emoji/release%20ready",
                body: expect.any(Buffer),
                contentType: expect.stringContaining("multipart/form-data"),
            }),
        );
        const request = transport.mock.calls[0]?.[0];
        expect(request?.body?.toString("utf8")).toContain('name="filename"; filename="ready.png"');
    });

    it("本人头像上传使用官方 file multipart 字段", async () => {
        const transport = vi.fn<ZulipTransport>().mockResolvedValue({
            result: "success",
            msg: "",
            avatar_url: "/user_avatars/2/avatar.png",
        });
        const client = new ZulipClient(config, { transport });

        await client.uploadOwnAvatar(Buffer.from("png"), "avatar.png", "image/png");

        expect(transport).toHaveBeenCalledWith(
            expect.objectContaining({
                method: "POST",
                path: "users/me/avatar",
                body: expect.any(Buffer),
                contentType: expect.stringContaining("multipart/form-data"),
            }),
        );
        const request = transport.mock.calls[0]?.[0];
        expect(request?.body?.toString("utf8")).toContain('name="file"; filename="avatar.png"');
    });

    it("在创建传输前拒绝不安全或不完整配置", () => {
        expect(
            () =>
                new ZulipClient({
                    ...config,
                    server_url: "http://zulip.example.com",
                }),
        ).toThrowError(expect.objectContaining({ code: "ZULIP_INVALID_CONFIG" }));
        expect(
            () =>
                new ZulipClient({
                    ...config,
                    server_url: "https://zulip.example.com/api/v1",
                }),
        ).toThrowError(expect.objectContaining({ code: "ZULIP_INVALID_CONFIG" }));
    });
});

function user() {
    return {
        result: "success",
        msg: "",
        user_id: 1,
        email: "bot@example.com",
        full_name: "Bot",
    };
}

function message() {
    return {
        id: 10,
        type: "private" as const,
        sender_id: 2,
        sender_email: "user@example.com",
        sender_full_name: "User",
        content: "hello",
        timestamp: 100,
    };
}
