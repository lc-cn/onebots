import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isQQSdkReconnectExhaustedLog, QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import { resolveIntentMask } from "./types.js";
import { QQWebhookHost } from "./webhook-host.js";

describe("QQClient", () => {
    afterEach(() => vi.restoreAllMocks());

    it("拒绝绝对 OpenAPI URL，避免凭据越界", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        await expect(
            client.call({ method: "GET", path: "https://evil.example/users/@me" }),
        ).rejects.toMatchObject({ code: "QQ_INVALID_API_PATH" } satisfies Partial<QQApiError>);
        await expect(
            client.call({ method: "GET", path: "/guilds/%2e%2e/users/@me" }),
        ).rejects.toMatchObject({ code: "QQ_INVALID_API_PATH" } satisfies Partial<QQApiError>);
    });

    it("将可读 Intent 列表准确转换为官方位图", () => {
        expect(resolveIntentMask(["GUILDS", "GROUP_AND_C2C_EVENT", "INTERACTION"])).toBe(
            1 + 33554432 + 67108864,
        );
        expect(resolveIntentMask(undefined)).toBeUndefined();
        expect(resolveIntentMask(["GUILDS", "GUILDS"])).toBe(1);
    });

    it("启动前加载真实机器人身份并复用并发启动", async () => {
        const start = vi.spyOn(QQBot.prototype, "start").mockImplementation(async signal => {
            await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve()));
        });
        vi.spyOn(QQBot.prototype, "stop").mockImplementation(() => undefined);
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        vi.spyOn(client, "call").mockResolvedValue({ id: "bot-openid", username: "Bot" });

        const first = client.run();
        const second = client.run();
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        expect(client.getCachedSelf()).toEqual({ id: "bot-openid", username: "Bot" });

        client.close();
        await Promise.all([first, second]);
    });

    it("stop 后的快速重启等待旧连接代次完成", async () => {
        const completions: Array<() => void> = [];
        const start = vi
            .spyOn(QQBot.prototype, "start")
            .mockImplementation(() => new Promise<void>(resolve => completions.push(resolve)));
        vi.spyOn(QQBot.prototype, "stop").mockImplementation(() => undefined);
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        vi.spyOn(client, "call").mockResolvedValue({ id: "bot-openid" });

        const first = client.run();
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        client.close();
        const second = client.run();
        expect(start).toHaveBeenCalledTimes(1);
        completions[0]();
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));

        client.close();
        completions[1]();
        await Promise.all([first, second]);
    });

    it("只把官方重连耗尽日志识别为新 transport 代次信号", () => {
        expect(
            isQQSdkReconnectExhaustedLog("[app] Max reconnect attempts reached or aborted"),
        ).toBe(true);
        expect(isQQSdkReconnectExhaustedLog("[app] WebSocket error: offline")).toBe(false);
    });

    it("重连耗尽时只重启内部 transport，不终止外层接收循环", async () => {
        let finishTransport: (() => void) | undefined;
        vi.spyOn(QQBot.prototype, "start").mockImplementation(
            () => new Promise<void>(resolve => (finishTransport = resolve)),
        );
        const stop = vi.spyOn(QQBot.prototype, "stop").mockImplementation(() => {
            finishTransport?.();
        });
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        vi.spyOn(client, "call").mockResolvedValue({ id: "bot-openid" });
        const run = client.run();
        await vi.waitFor(() => expect(client.getCachedSelf()).toBeDefined());

        client.restartTransportGeneration();
        expect(stop).toHaveBeenCalledTimes(1);
        client.close();
        await run;
    });

    it("拒绝缺少真实 ID 的机器人身份响应", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        vi.spyOn(client, "call").mockResolvedValue({ username: "Bot" });
        await expect(client.fetchSelf()).rejects.toMatchObject({
            code: "QQ_INVALID_SELF_RESPONSE",
        } satisfies Partial<QQApiError>);
    });

    it("DELETE 调用不会丢失 query", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        const request = vi.spyOn(client.api, "delete").mockResolvedValue({ ok: true });
        await client.call({ method: "DELETE", path: "/resource", query: { force: true } });
        expect(request).toHaveBeenCalledWith("/resource?force=true");
    });

    it("写操作统一保留结构化 query", async () => {
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
        );
        const request = vi.spyOn(client.api, "post").mockResolvedValue({ ok: true });

        await client.call({
            method: "POST",
            path: "/resource",
            query: { cursor: "next", enabled: true },
            body: { value: 1 },
        });

        expect(request).toHaveBeenCalledWith("/resource?cursor=next&enabled=true", { value: 1 });
    });

    it("将已有 HTTP Host 的原始请求委托给同一 Webhook 管线", async () => {
        const host = new QQWebhookHost("/qq/test/webhook", "test", vi.fn());
        await host.listen(0, "/ignored", async request => ({
            status: 200,
            body: request.body.toString("utf8"),
        }));
        const client = new QQClient(
            { appId: "app", appSecret: "secret" },
            { warn: vi.fn(), error: vi.fn() },
            host,
        );

        await expect(client.ingest({ body: Buffer.from("{}"), headers: {} })).resolves.toEqual({
            status: 200,
            body: "{}",
        });
    });
});
