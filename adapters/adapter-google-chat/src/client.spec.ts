import { describe, expect, it, vi } from "vitest";
import type { GoogleChatTokenVerifier } from "./auth.js";
import { GoogleChatClient } from "./client.js";
import type { GoogleChatConfig } from "./types.js";

const manualConfig: GoogleChatConfig = {
    account_id: "bot",
    auth_mode: "access-token",
    access_token: "api-token",
    receive_mode: "manual",
};

const interaction = {
    type: "MESSAGE",
    eventTime: "2026-08-31T01:02:03Z",
    user: { name: "users/alice", type: "HUMAN" },
    space: { name: "spaces/AAA", spaceType: "SPACE" },
    message: {
        name: "spaces/AAA/messages/one",
        sender: { name: "users/alice", type: "HUMAN" },
        text: "hello",
        space: { name: "spaces/AAA" },
    },
};

const verifier: GoogleChatTokenVerifier = { verify: vi.fn().mockResolvedValue(undefined) };

describe("GoogleChatClient", () => {
    it("按鉴权身份选择官方 principal alias，不把用户 OAuth 误作应用", () => {
        expect(new GoogleChatClient(manualConfig).principalName).toBe("users/me");
        expect(
            new GoogleChatClient({
                account_id: "app",
                auth_mode: "service-account",
                service_account_email: "bot@example.com",
                service_account_private_key:
                    "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
                receive_mode: "manual",
            }).principalName,
        ).toBe("users/app");
    });

    it("manual ingest 只在下游成功后提交去重，失败允许重投", async () => {
        const client = new GoogleChatClient(manualConfig);
        const listener = vi.fn().mockRejectedValueOnce(new Error("downstream failed"));
        client.on("event", listener);

        await expect(client.ingest(interaction)).rejects.toThrow("downstream failed");
        await expect(client.ingest(interaction)).resolves.toMatchObject([
            { accepted: true, duplicate: false },
        ]);
        await expect(client.ingest(interaction)).resolves.toMatchObject([
            { accepted: false, duplicate: true },
        ]);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("interaction HTTP 校验路径与 Bearer，并返回结构化同步响应", async () => {
        const client = new GoogleChatClient(
            {
                ...manualConfig,
                receive_mode: "interaction-http",
                http_path: "/google/events",
                verification_audience: "https://host.example/google/events",
            },
            { verifier, interactionResponse: event => ({ text: `ack:${event.type}` }) },
        );
        const response = await client.acceptHttp(
            new Request("https://host.example/google/events", {
                method: "POST",
                headers: {
                    authorization: "Bearer signed",
                    "content-type": "application/json",
                },
                body: JSON.stringify(interaction),
            }),
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ text: "ack:MESSAGE" });
        expect(verifier.verify).toHaveBeenCalledWith(
            "signed",
            "endpoint-url",
            "https://host.example/google/events",
            undefined,
        );

        const wrongPath = await client.acceptHttp(
            new Request("https://host.example/wrong", {
                method: "POST",
                headers: { authorization: "Bearer signed" },
                body: JSON.stringify(interaction),
            }),
        );
        expect(wrongPath.status).toBe(404);
    });

    it("Pub/Sub 只有下游成功才 ACK，同一 messageId 与 CloudEvent id 幂等", async () => {
        const client = new GoogleChatClient(
            {
                ...manualConfig,
                receive_mode: "pubsub-push",
                http_path: "/pubsub",
                verification_audience: "pubsub-audience",
                pubsub_service_account_email: "push@example.com",
            },
            {
                verifier,
                fetcher: vi
                    .fn<typeof fetch>()
                    .mockResolvedValue(Response.json({ name: "spaces/AAA", spaceType: "SPACE" })),
            },
        );
        const listener = vi.fn().mockRejectedValueOnce(new Error("protocol unavailable"));
        client.on("event", listener);
        const body = pubsubBody(cloudMessage());
        const deliver = () =>
            client.ingestHttp({
                method: "POST",
                url: "/pubsub",
                headers: { authorization: "Bearer oidc" },
                body,
            });

        await expect(deliver()).resolves.toMatchObject({ status: 500 });
        await expect(deliver()).resolves.toMatchObject({ status: 200 });
        await expect(deliver()).resolves.toMatchObject({ status: 200 });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(verifier.verify).toHaveBeenCalledWith(
            "oidc",
            "pubsub",
            "pubsub-audience",
            "push@example.com",
        );
    });

    it("manual 模式显式拒绝 HTTP，HTTP 模式拒绝缺失身份与错误方法", async () => {
        const manual = new GoogleChatClient(manualConfig);
        await expect(
            manual.ingestHttp({ method: "POST", url: "/", body: interaction }),
        ).resolves.toMatchObject({ status: 409 });

        const http = new GoogleChatClient(
            {
                ...manualConfig,
                receive_mode: "interaction-http",
                verification_audience: "https://example.com/google-chat",
            },
            { verifier },
        );
        await expect(
            http.ingestHttp({ method: "GET", url: "/", body: interaction }),
        ).resolves.toMatchObject({ status: 405 });
        await expect(
            http.ingestHttp({ method: "POST", url: "/", body: interaction }),
        ).resolves.toMatchObject({ status: 401 });
    });

    it("并发 start 单飞，ready 失败后不会提交状态并可重试", async () => {
        const client = new GoogleChatClient(manualConfig);
        const ready = vi.fn();
        client.on("ready", ready);
        await Promise.all([client.start(), client.start()]);
        await client.start();
        expect(ready).toHaveBeenCalledOnce();

        const retry = new GoogleChatClient(manualConfig);
        retry.on("ready", vi.fn().mockRejectedValueOnce(new Error("bootstrap failed")));
        await expect(retry.start()).rejects.toThrow("bootstrap failed");
        await expect(retry.start()).resolves.toBeUndefined();
    });

    it("启动信号会取消 OAuth 初始化并在 stop 时丢弃凭证状态", async () => {
        const auth = {
            accessToken: vi.fn(
                (signal?: AbortSignal) =>
                    new Promise<string>((_resolve, reject) => {
                        signal?.addEventListener("abort", () =>
                            reject(new DOMException("aborted", "AbortError")),
                        );
                    }),
            ),
            reset: vi.fn(),
        };
        const client = new GoogleChatClient(manualConfig, { auth });
        const controller = new AbortController();

        const starting = client.start(controller.signal);
        await vi.waitFor(() => expect(auth.accessToken).toHaveBeenCalledOnce());
        expect(auth.accessToken).toHaveBeenCalledWith(expect.any(AbortSignal));
        controller.abort();

        await expect(starting).rejects.toMatchObject({ code: "GOOGLE_CHAT_START_CANCELLED" });
        await client.stop();
        expect(auth.reset).toHaveBeenCalledOnce();
    });

    it("ready 监听器执行期间取消时不会提交旧账号状态", async () => {
        const client = new GoogleChatClient(manualConfig);
        const controller = new AbortController();
        let readyEntered!: () => void;
        let releaseReady!: () => void;
        const entered = new Promise<void>(resolve => {
            readyEntered = resolve;
        });
        const blocked = new Promise<void>(resolve => {
            releaseReady = resolve;
        });
        client.on("ready", () => {
            readyEntered();
            return blocked;
        });

        const starting = client.start(controller.signal);
        await entered;
        controller.abort();
        releaseReady();

        await expect(starting).rejects.toMatchObject({ code: "GOOGLE_CHAT_START_CANCELLED" });
    });
});

function cloudMessage(): Record<string, unknown> {
    return {
        specversion: "1.0",
        id: "cloud-1",
        source: "//workspaceevents.googleapis.com/subscriptions/sub",
        type: "google.workspace.chat.message.v1.created",
        time: "2026-08-31T01:02:03Z",
        data: { message: interaction.message },
    };
}

function pubsubBody(event: Record<string, unknown>): Record<string, unknown> {
    return {
        message: {
            messageId: "pubsub-1",
            data: Buffer.from(JSON.stringify(event)).toString("base64"),
        },
        subscription: "projects/project/subscriptions/sub",
    };
}
