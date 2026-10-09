import { createServer } from "node:http";
import { createServer as createSmtpServer } from "node:net";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
    BarkPartialDeliveryError,
    deliverBark,
    deliverEmail,
    deliverWebhook,
} from "./notification-delivery.js";
import { emptyNotificationConfig } from "./notification-config.js";
import type { BarkChannel, NotificationEvent, WebhookChannel } from "./notification-types.js";
import type { ControlVerificationChallenge } from "@onebots/core/control";

const servers: Array<ReturnType<typeof createServer>> = [];
const smtpServers: Array<ReturnType<typeof createSmtpServer>> = [];
afterEach(async () => {
    await Promise.all(
        servers
            .splice(0)
            .map(server => new Promise<void>(resolve => server.close(() => resolve()))),
    );
    await Promise.all(
        smtpServers
            .splice(0)
            .map(server => new Promise<void>(resolve => server.close(() => resolve()))),
    );
});

async function receiver(barkCodes?: number[], hostname = "127.0.0.1") {
    let received:
        | { path: string; body: string; headers: Record<string, string | string[] | undefined> }
        | undefined;
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", chunk => chunks.push(Buffer.from(chunk)));
        request.on("end", () => {
            received = {
                path: request.url ?? "",
                body: Buffer.concat(chunks).toString(),
                headers: request.headers,
            };
            response.writeHead(200, { "content-type": "application/json" });
            const payload: { device_keys?: string[] } = JSON.parse(received.body);
            response.end(
                JSON.stringify({
                    code: 200,
                    data: payload.device_keys?.map((device_key, index) => ({
                        device_key,
                        code: barkCodes?.[index] ?? 200,
                    })),
                }),
            );
        });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, hostname, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("receiver unavailable");
    return { url: `http://${hostname}:${address.port}`, received: () => received };
}

const event: NotificationEvent = {
    id: "event-1",
    type: "login.interaction",
    title: "登录交互",
    summary: "账号需要扫码",
    occurredAt: "2026-09-24T00:00:00.000Z",
    challengeId: "challenge-1",
};

describe("notification delivery", () => {
    it("sends through a reusable SMTP profile and recipient group", async () => {
        let received = "";
        const server = createSmtpServer(socket => {
            socket.write("220 localhost ESMTP\r\n");
            let buffer = "";
            let data = false;
            socket.on("data", chunk => {
                buffer += chunk.toString();
                while (buffer.includes("\r\n")) {
                    const boundary = buffer.indexOf("\r\n");
                    const line = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    if (data) {
                        if (line === ".") {
                            data = false;
                            socket.write("250 queued\r\n");
                        } else received += `${line}\n`;
                    } else if (/^EHLO /i.test(line)) socket.write("250-localhost\r\n250 OK\r\n");
                    else if (line === "DATA") {
                        data = true;
                        socket.write("354 continue\r\n");
                    } else if (line === "QUIT") {
                        socket.write("221 bye\r\n");
                        socket.end();
                    } else socket.write("250 OK\r\n");
                }
            });
        });
        smtpServers.push(server);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("SMTP unavailable");
        const smtpId = "smtp",
            groupId = "group";
        const config = {
            ...emptyNotificationConfig(),
            smtpProfiles: [
                {
                    id: smtpId,
                    name: "local",
                    host: "127.0.0.1",
                    port: address.port,
                    secure: false,
                    username: "",
                    password: "",
                    from: "onebots@example.com",
                },
            ],
            recipientGroups: [
                { id: groupId, name: "operators", addresses: ["operator@example.com"] },
            ],
        };
        await deliverEmail(
            {
                id: "email",
                name: "email",
                type: "email",
                enabled: true,
                includeChallengeLink: false,
                smtpId,
                groupId,
            },
            config,
            [event],
        );
        expect(received).toContain("onebots@example.com");
        expect(received).toContain("operator@example.com");
    });
    it("pins a permitted local Webhook endpoint and signs the exact JSON body", async () => {
        const target = await receiver();
        const channel: WebhookChannel = {
            id: "webhook",
            name: "Webhook",
            type: "webhook",
            enabled: true,
            includeChallengeLink: false,
            url: target.url,
            allowPrivateNetwork: true,
            auth: { type: "hmac", secret: "test-secret" },
        };
        await deliverWebhook(channel, emptyNotificationConfig(), [event]);
        const result = target.received();
        expect(result?.path).toBe("/");
        const timestamp = result?.headers["x-onebots-timestamp"];
        expect(result?.headers["x-onebots-signature"]).toBe(
            `sha256=${createHmac("sha256", "test-secret")
                .update(`${timestamp}.${result?.body}`)
                .digest("hex")}`,
        );
        expect(JSON.parse(result!.body)).toMatchObject({ version: 1, events: [event] });
    });

    it("uses the Bark V2 push endpoint and protected console link", async () => {
        const target = await receiver();
        const channel: BarkChannel = {
            id: "bark",
            name: "Bark",
            type: "bark",
            enabled: true,
            includeChallengeLink: true,
            serverUrl: `${target.url}/bark`,
            deviceKeys: ["device-one", "device-two"],
            allowPrivateNetwork: true,
        };
        await deliverBark(
            channel,
            { ...emptyNotificationConfig(), externalUrl: "https://onebots.example.com/" },
            [event],
        );
        const result = target.received();
        expect(result?.path).toBe("/bark/push");
        expect(JSON.parse(result!.body)).toMatchObject({
            device_keys: ["device-one", "device-two"],
            url: "https://onebots.example.com/#activity",
        });
    });

    it("delivers to a DNS hostname when Node requests all lookup addresses", async () => {
        const target = await receiver(undefined, "localhost");
        const channel: BarkChannel = {
            id: "bark-dns",
            name: "Bark DNS",
            type: "bark",
            enabled: true,
            includeChallengeLink: false,
            serverUrl: target.url,
            deviceKeys: ["device-one"],
            allowPrivateNetwork: true,
        };
        await deliverBark(channel, emptyNotificationConfig(), [event]);
        expect(target.received()?.path).toBe("/push");
    });

    it("does not report batch success when Bark rejects one device", async () => {
        const target = await receiver([200, 400]);
        const channel: BarkChannel = {
            id: "bark",
            name: "Bark",
            type: "bark",
            enabled: true,
            includeChallengeLink: false,
            serverUrl: target.url,
            deviceKeys: ["device-one", "device-two"],
            allowPrivateNetwork: true,
        };
        await expect(
            deliverBark(channel, emptyNotificationConfig(), [event]),
        ).rejects.toBeInstanceOf(BarkPartialDeliveryError);
    });

    it("identifies when Bark rejects every configured device", async () => {
        const target = await receiver([400]);
        const channel: BarkChannel = {
            id: "bark-rejected",
            name: "Bark",
            type: "bark",
            enabled: true,
            includeChallengeLink: false,
            serverUrl: target.url,
            deviceKeys: ["device-one"],
            allowPrivateNetwork: true,
        };
        await expect(deliverBark(channel, emptyNotificationConfig(), [event])).rejects.toThrow(
            "Bark 服务拒绝全部设备 Key，请确认设备已在当前服务注册",
        );
    });

    it("only forwards selected login display materials, never inputs or adapter data", async () => {
        const target = await receiver();
        const channel: WebhookChannel = {
            id: "webhook",
            name: "Webhook",
            type: "webhook",
            enabled: true,
            includeChallengeLink: true,
            url: target.url,
            allowPrivateNetwork: true,
            auth: { type: "none" },
        };
        const challenge: ControlVerificationChallenge = {
            id: "challenge-1",
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            request: {
                platform: "icqq",
                account_id: "1",
                type: "scan",
                hint: "扫码",
                options: {
                    blocks: [
                        { type: "image", base64: "aGVsbG8=" },
                        { type: "input", key: "sms", secret: true },
                    ],
                },
                data: { privateToken: "never-send-this" },
            },
        };
        await deliverWebhook(
            channel,
            { ...emptyNotificationConfig(), externalUrl: "https://onebots.example.com" },
            [event],
            challenge,
        );
        const body = target.received()?.body ?? "";
        expect(body).toContain("aGVsbG8=");
        expect(body).not.toContain("privateToken");
        expect(body).not.toContain("never-send-this");
        expect(body).not.toContain('"sms"');
    });

    it("rejects a local target without explicit private-network opt-in", async () => {
        const target = await receiver();
        const channel: WebhookChannel = {
            id: "webhook",
            name: "Webhook",
            type: "webhook",
            enabled: true,
            includeChallengeLink: false,
            url: target.url,
            allowPrivateNetwork: false,
            auth: { type: "none" },
        };
        await expect(deliverWebhook(channel, emptyNotificationConfig(), [event])).rejects.toThrow(
            /HTTPS/,
        );
        expect(target.received()).toBeUndefined();
    });
});
