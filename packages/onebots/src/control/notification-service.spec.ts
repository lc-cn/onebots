import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ControlNotificationService } from "./notification-service.js";
import {
    emptyNotificationConfig,
    parseNotificationConfig,
    publicNotificationConfig,
} from "./notification-config.js";
import type { NotificationConfig } from "./notification-types.js";

const directories: string[] = [];
const services: ControlNotificationService[] = [];
afterEach(() => {
    services.forEach(service => service.close());
    services.length = 0;
    directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
    directories.length = 0;
});

function service(now: () => number) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-notification-"));
    directories.push(directory);
    const instance = new ControlNotificationService(directory, now);
    services.push(instance);
    return { instance, directory };
}

function config(): NotificationConfig {
    const channelId = randomUUID();
    return {
        ...emptyNotificationConfig(),
        channels: [
            {
                id: channelId,
                name: "Webhook",
                enabled: true,
                includeChallengeLink: false,
                type: "webhook",
                url: "https://example.com/events",
                allowPrivateNetwork: false,
                auth: { type: "hmac", secret: "private-secret" },
            },
        ],
        rules: [
            {
                id: randomUUID(),
                name: "账号状态",
                enabled: true,
                events: [
                    "account.online",
                    "account.offline",
                    "account.recovered",
                    "account.brief-outage",
                ],
                accounts: "all",
                channelIds: [channelId],
            },
        ],
    };
}

describe("management notifications", () => {
    it("never returns transport secrets and preserves them on an edit", () => {
        const first = config();
        first.channels.push({
            id: randomUUID(),
            name: "Bark",
            enabled: true,
            includeChallengeLink: false,
            type: "bark",
            serverUrl: "https://api.day.app",
            deviceKeys: ["key-one", "key-two"],
            allowPrivateNetwork: false,
        });
        const publicConfig = publicNotificationConfig(first);
        expect(JSON.stringify(publicConfig)).not.toContain("private-secret");
        expect(JSON.stringify(publicConfig)).not.toContain("key-one");
        const bark = publicConfig.channels.find(item => item.type === "bark");
        if (!bark || bark.type !== "bark") throw new Error("missing Bark");
        bark.deviceKeys.splice(0, 1);
        const edited = parseNotificationConfig(publicConfig, first);
        expect(edited.channels.find(item => item.type === "bark")).toMatchObject({
            deviceKeys: ["key-two"],
        });
        expect(edited.channels[0]).toMatchObject({ auth: { secret: "private-secret" } });
    });

    it("merges an offline/recovery pair before delivery and persists it", () => {
        let time = 1_750_000_000_000;
        const { instance, directory } = service(() => time);
        instance.configure(config());
        instance.observeAccounts([{ platform: "icqq", accountId: "1", status: "online" }]);
        time += 1_000;
        instance.observeAccounts([{ platform: "icqq", accountId: "1", status: "offline" }]);
        time += 5_000;
        instance.observeAccounts([{ platform: "icqq", accountId: "1", status: "online" }]);
        const deliveries = instance.snapshot().deliveries;
        expect(
            deliveries.some(item =>
                item.events.some(event => event.type === "account.brief-outage"),
            ),
        ).toBe(true);
        expect(
            deliveries.some(item => item.events.some(event => event.type === "account.recovered")),
        ).toBe(false);
        instance.close();
        const reopened = new ControlNotificationService(directory, () => time);
        services.push(reopened);
        expect(reopened.snapshot().deliveries).toEqual(deliveries);
    });

    it("requires an external console URL for Bark login interaction alerts", () => {
        const value = config();
        const barkId = randomUUID();
        value.channels.push({
            id: barkId,
            name: "Bark",
            enabled: true,
            includeChallengeLink: true,
            type: "bark",
            serverUrl: "https://api.day.app",
            deviceKeys: ["key"],
            allowPrivateNetwork: false,
        });
        value.rules.push({
            id: randomUUID(),
            name: "登录",
            enabled: true,
            events: ["login.interaction"],
            accounts: "all",
            channelIds: [barkId],
        });
        expect(() => parseNotificationConfig(value)).toThrow(/外部访问 URL/);
        value.externalUrl = "https://onebots.example.com";
        expect(() => parseNotificationConfig(value)).not.toThrow();
    });

    it("records one explicit disconnect per outage until the account reconnects", () => {
        let time = 1_750_000_000_000;
        const { instance } = service(() => time);
        const value = config();
        value.rules[0].events.push("account.disconnected");
        instance.configure(value);
        instance.observeAccounts([{ platform: "icqq", accountId: "1", status: "online" }]);
        instance.observeDisconnect({ platform: "icqq", accountId: "1" });
        instance.observeDisconnect({ platform: "icqq", accountId: "1" });
        expect(
            instance
                .snapshot()
                .deliveries.flatMap(item => item.events)
                .filter(event => event.type === "account.disconnected"),
        ).toHaveLength(1);
        time += 31_000;
        instance.observeAccounts([{ platform: "icqq", accountId: "1", status: "online" }]);
        instance.observeDisconnect({ platform: "icqq", accountId: "1" });
        expect(
            instance
                .snapshot()
                .deliveries.flatMap(item => item.events)
                .filter(event => event.type === "account.disconnected"),
        ).toHaveLength(2);
    });
});
