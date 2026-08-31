import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MetaWebhookCodec } from "./types.js";
import { isRecord } from "./validation.js";
import { MetaWebhookClient } from "./webhook.js";

interface Envelope {
    object: string;
    entries: Array<{ id: string; value: string }>;
}

const codec: MetaWebhookCodec<{ value: string }, Envelope> = {
    parse(value) {
        if (!isRecord(value) || value.object !== "page" || !Array.isArray(value.entry)) {
            throw new Error("invalid envelope");
        }
        return {
            object: "page",
            entries: value.entry.map(item => {
                if (
                    !isRecord(item) ||
                    typeof item.id !== "string" ||
                    typeof item.value !== "string"
                ) {
                    throw new Error("invalid entry");
                }
                return { id: item.id, value: item.value };
            }),
        };
    },
    expand(envelope) {
        return envelope.entries.map(entry => ({
            id: entry.id,
            event: { value: entry.value },
            rawEnvelope: envelope,
        }));
    },
};

describe("MetaWebhookClient", () => {
    it("合并并发启动，且 stop 可使迟到的 start 失效", async () => {
        const client = new MetaWebhookClient({ receiveMode: "manual" }, codec);
        let release: (() => void) | undefined;
        const ready = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        const stopped = vi.fn();
        client.on("ready", ready);
        client.on("stop", stopped);

        const first = client.start();
        const second = client.start();
        const stopping = client.stop();
        release?.();
        await Promise.all([first, second, stopping]);

        expect(ready).toHaveBeenCalledTimes(1);
        expect(stopped).not.toHaveBeenCalled();
        expect(client.isStarted).toBe(false);
        client.removeListener("ready", ready);
        await client.start();
        expect(client.isStarted).toBe(true);
        await Promise.all([client.stop(), client.stop()]);
        expect(stopped).toHaveBeenCalledTimes(1);
    });

    it("完成官方 GET challenge 与精确 raw-body SHA256 校验", async () => {
        const client = new MetaWebhookClient(
            {
                verifyToken: "verify",
                appSecret: "secret",
                httpPath: "/meta/events",
            },
            codec,
        );
        const challenge = await client.acceptHttp(
            new Request(
                "https://example.com/meta/events?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=OK",
            ),
        );
        expect(challenge.status).toBe(200);
        await expect(challenge.text()).resolves.toBe("OK");

        const raw = JSON.stringify({ object: "page", entry: [{ id: "one", value: "hello" }] });
        const event = vi.fn();
        client.on("event", event);
        const response = await client.acceptHttp(
            new Request("https://example.com/meta/events", {
                method: "POST",
                headers: { "x-hub-signature-256": signature(raw) },
                body: raw,
            }),
        );
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("EVENT_RECEIVED");
        expect(event).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
    });

    it("业务失败不提交去重，上游重试可重新投递", async () => {
        const client = new MetaWebhookClient({ receiveMode: "manual" }, codec);
        const listener = vi.fn().mockRejectedValueOnce(new Error("downstream unavailable"));
        client.on("event", listener);
        const payload = { object: "page", entry: [{ id: "same", value: "hello" }] };

        await expect(client.ingest(payload)).rejects.toThrow("downstream unavailable");
        await expect(client.ingest(payload)).resolves.toMatchObject([
            { accepted: true, duplicate: false },
        ]);
        await expect(client.ingest(payload)).resolves.toMatchObject([
            { accepted: false, duplicate: true },
        ]);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("拒绝错误签名、缺失 rawBody、路径错配与 manual HTTP", async () => {
        const client = new MetaWebhookClient(
            { verifyToken: "verify", appSecret: "secret", httpPath: "/events" },
            codec,
        );
        const rawBody = new TextEncoder().encode(
            JSON.stringify({ object: "page", entry: [{ id: "one", value: "hello" }] }),
        );
        await expect(
            client.ingestHttp({
                method: "POST",
                url: "/events",
                headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
                rawBody,
            }),
        ).resolves.toMatchObject({ status: 401 });
        await expect(
            client.ingestHttp({ method: "POST", url: "/events", headers: {} }),
        ).resolves.toMatchObject({ status: 400 });
        await expect(
            client.ingestHttp({ method: "POST", url: "/wrong", headers: {}, rawBody }),
        ).resolves.toMatchObject({ status: 404 });

        const manual = new MetaWebhookClient({ receiveMode: "manual" }, codec);
        await expect(
            manual.ingestHttp({ method: "POST", url: "/", rawBody }),
        ).resolves.toMatchObject({ status: 409 });
    });

    it("在读取 chunked Request 时执行实际字节上限", async () => {
        const client = new MetaWebhookClient(
            {
                verifyToken: "verify",
                appSecret: "secret",
                maxBodyBytes: 4,
            },
            codec,
        );
        const response = await client.acceptHttp(
            new Request("https://example.com/events", {
                method: "POST",
                headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode("123"));
                        controller.enqueue(new TextEncoder().encode("45"));
                        controller.close();
                    },
                }),
                duplex: "half",
            } as RequestInit & { duplex: "half" }),
        );
        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: "META_BODY_TOO_LARGE" },
        });
    });
});

function signature(body: string): string {
    return `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
}
