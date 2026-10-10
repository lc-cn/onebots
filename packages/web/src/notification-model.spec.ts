import { afterEach, describe, expect, it, vi } from "vitest";
import {
    addChannel,
    notificationStatusLabel,
    type NotificationSnapshot,
} from "./notification-model.js";

function snapshot(): NotificationSnapshot {
    return {
        config: {
            schemaVersion: 1,
            externalUrl: "",
            smtpProfiles: [],
            recipientGroups: [],
            channels: [
                {
                    id: "channel",
                    name: "Webhook",
                    type: "webhook",
                    enabled: true,
                    includeChallengeLink: false,
                    url: "https://example.com/events",
                    allowPrivateNetwork: false,
                    auth: { type: "none" },
                },
            ],
            rules: [],
        },
        deliveries: [],
        droppedDeliveries: 0,
    };
}

describe("notificationStatusLabel", () => {
    it("does not claim notifications are ready merely because a channel exists", () => {
        const current = snapshot();
        expect(notificationStatusLabel(current)).toBe("待配置规则");
        current.config.rules.push({
            id: "rule",
            name: "异常",
            enabled: true,
            events: ["gateway.failed"],
            accounts: "all",
            channelIds: ["channel"],
        });
        expect(notificationStatusLabel(current)).toBe("已设置");
        current.config.channels[0]!.enabled = false;
        expect(notificationStatusLabel(current)).toBe("未设置");
    });

    it("puts failed and pending deliveries ahead of configuration readiness", () => {
        const current = snapshot();
        current.deliveries.push({
            id: "delivery",
            channelId: "channel",
            status: "failed",
            attempts: 1,
            createdAt: "2026-09-24T00:00:00.000Z",
            events: [],
        });
        expect(notificationStatusLabel(current)).toBe("1 条失败");
        current.deliveries[0]!.status = "pending";
        expect(notificationStatusLabel(current)).toBe("1 条待发送");
        current.droppedDeliveries = 2;
        expect(notificationStatusLabel(current)).toBe("2 条未排队");
    });
});

afterEach(() => vi.unstubAllGlobals());
it("HTTP 页面没有 randomUUID 时仍可添加通知渠道", () => {
    vi.stubGlobal("crypto", {
        getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    const ids = ["webhook", "email", "bark"].map(
        type => addChannel(type as "webhook" | "email" | "bark").id,
    );
    expect(new Set(ids).size).toBe(3);
    for (const id of ids)
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
