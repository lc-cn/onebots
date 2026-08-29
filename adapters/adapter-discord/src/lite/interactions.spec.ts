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

    it("拒绝无效原始事件并返回结构化错误", async () => {
        const handler = new InteractionsHandler({ publicKey, token: "token", applicationId: "1" });
        await expect(handler.ingest({ type: 2 })).rejects.toMatchObject({
            name: "DiscordError",
            code: "DISCORD_INTERACTION_INVALID",
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
