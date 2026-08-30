import { describe, expect, it, vi } from "vitest";
import {
    InteractionCallbackType,
    InteractionType,
    InteractionsHandler,
    verifyInteractionSignature,
} from "./interactions.js";

const publicKey = "00".repeat(32);

describe("Discord Interactions ingestion", () => {
    it("无需自建 HTTP 服务即可 ingest 原始 Interaction", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        const command = vi.fn(() => InteractionsHandler.messageResponse("pong"));
        handler.onCommand("ping", command);

        await expect(
            handler.ingest({
                id: "2",
                application_id: "1",
                type: InteractionType.ApplicationCommand,
                token: "interaction-token",
                version: 1,
                data: { name: "ping" },
            }),
        ).resolves.toEqual({
            type: InteractionCallbackType.ChannelMessageWithSource,
            data: { content: "pong", flags: 0 },
        });
        expect(command).toHaveBeenCalledOnce();
    });

    it("组件路由优先精确匹配与最长前缀，不依赖注册顺序", async () => {
        const handler = new InteractionsHandler({ token: "token", trustedIngress: true });
        const broad = vi.fn(() => InteractionsHandler.messageResponse("broad"));
        const specific = vi.fn(() => InteractionsHandler.messageResponse("specific"));
        handler.onComponent("settings:", broad);
        handler.onComponent("settings:admin:", specific);

        await expect(
            handler.ingest({
                id: "component-1",
                application_id: "1",
                type: InteractionType.MessageComponent,
                token: "interaction-token",
                version: 1,
                data: { custom_id: "settings:admin:delete" },
            }),
        ).resolves.toMatchObject({ data: { content: "specific" } });
        expect(specific).toHaveBeenCalledOnce();
        expect(broad).not.toHaveBeenCalled();
    });

    it("拒绝无效原始事件并返回结构化错误", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        await expect(handler.ingest({ type: 2 })).rejects.toMatchObject({
            name: "DiscordError",
            code: "DISCORD_INTERACTION_INVALID",
        });
    });

    it("manual 仅接收上游已验签事件，不会退化为无验签 HTTP 入口", async () => {
        const handler = new InteractionsHandler({ token: "token", trustedIngress: true });

        await expect(
            handler.ingest({
                id: "2",
                application_id: "1",
                type: InteractionType.Ping,
                token: "interaction-token",
                version: 1,
            }),
        ).resolves.toEqual({ type: InteractionCallbackType.Pong });
        await expect(handler.ingestHttp({ body: "{}" })).resolves.toEqual({
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: {
                error: "DISCORD_INTERACTION_PUBLIC_KEY_REQUIRED",
                message: "Discord manual 模式未启用本地 HTTP 验签",
            },
        });
        await expect(handler.sendFollowup("token", { content: "test" })).rejects.toMatchObject({
            code: "DISCORD_INTERACTION_APPLICATION_ID_REQUIRED",
        });
    });

    it("将用户处理器异常闭合为 DiscordError", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        handler.onCommand("broken", () => {
            throw new Error("secret internal detail");
        });

        await expect(
            handler.ingest({
                id: "2",
                application_id: "1",
                type: InteractionType.ApplicationCommand,
                token: "interaction-token",
                version: 1,
                data: { name: "broken" },
            }),
        ).rejects.toMatchObject({
            name: "DiscordError",
            code: "DISCORD_INTERACTION_HANDLER_FAILED",
        });
    });

    it("HTTP 入口在验签前拒绝缺失与过期签名", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        const missing = await handler.acceptHttp(
            new Request("https://example.test", { method: "POST" }),
        );
        expect(missing.status).toBe(401);
        await expect(missing.json()).resolves.toEqual({ error: "missing_signature" });

        const stale = await handler.acceptHttp(
            new Request("https://example.test", {
                method: "POST",
                headers: {
                    "x-signature-ed25519": "00".repeat(64),
                    "x-signature-timestamp": "1",
                },
            }),
        );
        expect(stale.status).toBe(401);
        await expect(stale.json()).resolves.toEqual({ error: "expired_signature" });
    });

    it("标准 HTTP 入口拒绝非 POST 方法", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        const response = await handler.acceptHttp(
            new Request("https://example.test", { method: "GET" }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
        await expect(response.json()).resolves.toMatchObject({
            error: "DISCORD_INTERACTION_METHOD_NOT_ALLOWED",
        });
    });

    it("Discord 重投返回首次响应且不重复触发业务事件", async () => {
        const onInteraction = vi.fn();
        const handler = new InteractionsHandler({
            publicKey,
            token: "token",
            applicationId: "1",
            onInteraction,
        });
        const command = vi.fn(() => InteractionsHandler.messageResponse("first"));
        handler.onCommand("ping", command);
        const interaction = {
            id: "replayed",
            application_id: "1",
            type: InteractionType.ApplicationCommand,
            token: "interaction-token",
            version: 1,
            data: { name: "ping" },
        };

        const first = await handler.ingest(interaction);
        if (first.data) first.data.content = "mutated";
        await expect(handler.ingest(interaction)).resolves.toMatchObject({
            data: { content: "first" },
        });
        expect(command).toHaveBeenCalledOnce();
        expect(onInteraction).toHaveBeenCalledOnce();
    });

    it("并发重投共享同一次业务处理", async () => {
        const handler = new InteractionsHandler({
            token: "token",
            trustedIngress: true,
        });
        let release: (() => void) | undefined;
        const waiting = new Promise<void>(resolve => {
            release = resolve;
        });
        const command = vi.fn(async () => {
            await waiting;
            return InteractionsHandler.messageResponse("once");
        });
        handler.onCommand("ping", command);
        const interaction = {
            id: "123",
            application_id: "456",
            type: InteractionType.ApplicationCommand,
            version: 1,
            token: "secret",
            data: { name: "ping" },
        };

        const first = handler.ingest(interaction);
        const second = handler.ingest(structuredClone(interaction));
        release?.();

        await expect(Promise.all([first, second])).resolves.toEqual([
            InteractionsHandler.messageResponse("once"),
            InteractionsHandler.messageResponse("once"),
        ]);
        expect(command).toHaveBeenCalledOnce();
    });

    it("处理失败不会提交 Interaction 响应缓存", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        const command = vi
            .fn()
            .mockRejectedValueOnce(new Error("temporary"))
            .mockReturnValueOnce(InteractionsHandler.messageResponse("recovered"));
        handler.onCommand("retry", command);
        const interaction = {
            id: "retryable",
            application_id: "1",
            type: InteractionType.ApplicationCommand,
            token: "interaction-token",
            version: 1,
            data: { name: "retry" },
        };

        await expect(handler.ingest(interaction)).rejects.toMatchObject({
            code: "DISCORD_INTERACTION_HANDLER_FAILED",
        });
        await expect(handler.ingest(interaction)).resolves.toMatchObject({
            data: { content: "recovered" },
        });
        expect(command).toHaveBeenCalledTimes(2);
    });

    it("公开 Activities 的 LAUNCH_ACTIVITY callback", () => {
        expect(InteractionsHandler.launchActivityResponse()).toEqual({
            type: InteractionCallbackType.LaunchActivity,
        });
    });

    it("畸形十六进制签名不会进入 Web Crypto", async () => {
        await expect(verifyInteractionSignature(publicKey, "zz", "1", "{}")).resolves.toBe(false);
    });

    it("验证真实 Ed25519 签名并返回宿主无关的结构化响应", async () => {
        const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
        const exported = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
        const timestamp = String(Math.floor(Date.now() / 1000));
        const body = JSON.stringify({
            id: "2",
            application_id: "1",
            type: InteractionType.Ping,
            token: "interaction-token",
            version: 1,
        });
        const signature = new Uint8Array(
            await crypto.subtle.sign(
                "Ed25519",
                keys.privateKey,
                new TextEncoder().encode(timestamp + body),
            ),
        );
        const handler = new InteractionsHandler({
            publicKey: hex(exported),
            token: "token",
            applicationId: "1",
        });

        await expect(
            handler.ingestHttp({ body, timestamp, signature: hex(signature) }),
        ).resolves.toEqual({
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: { type: InteractionCallbackType.Pong },
        });
    });
});

function hex(bytes: Uint8Array): string {
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
