import { EventEmitter } from "node:events";
import type { Account, Adapter } from "onebots";
import { describe, expect, it, vi } from "vitest";
import type { ICQQBot } from "./bot.js";
import { wireICQQAccountEvents } from "./account-events.js";

class FakeBot extends EventEmitter {}

class FakeAccount extends EventEmitter {
    readonly client = new FakeBot();
    readonly config = { account_id: "123456" };
    status = "pending";
    nickname = "";
    avatar = "";
    dispatchAwaited = vi.fn();
}

describe("ICQQ 账号登录验证事件", () => {
    it("将 system.login.auth 的验证链接与设备信息推送到 Web 验证面板", () => {
        const account = new FakeAccount();
        const emit = vi.fn<(event: string, payload: unknown) => void>();
        wireICQQAccountEvents(account as unknown as Account<"icqq", ICQQBot>, {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            emit,
            projectionContext: vi.fn(),
        });

        account.client.emit("auth", {
            url: "https://accounts.example.test/verify",
            device: {
                guid: "0011223344556677",
                qimei: "qimei-value",
                qimei36: "qimei36-value",
                subappid: "537200000",
                platform: "AndroidPad",
                brand: "OneBots",
                model: "Virtual Device",
                bssid: "",
                devInfo: "OneBots Virtual Device",
                sysVersion: "35",
            },
        });

        const request = emit.mock.calls.find(([event]) => event === "verification:request")?.[1] as
            | Adapter.VerificationRequest
            | undefined;
        expect(request).toMatchObject({
            platform: "icqq",
            account_id: "123456",
            type: "auth",
            confirmable: true,
        });
        expect(request?.options?.blocks).toContainEqual({
            type: "link",
            url: "https://accounts.example.test/verify",
            label: "前往身份验证页面",
        });
        const device = request?.options?.blocks
            ?.filter(block => block.type === "text")
            .map(block => block.content)
            .join("\n");
        expect(device).toContain("设备信息（验证页面可能需要）");
        expect(device).toContain("guid: 0011223344556677");
        expect(device).toContain("platform: AndroidPad");
        expect(device).toContain("model: Virtual Device");
        expect(device).toContain("sysVersion: 35");
    });
});
