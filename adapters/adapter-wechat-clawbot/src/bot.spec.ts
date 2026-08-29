import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatIlinkBot } from "./bot.js";
import { MemoryCredentialStore } from "./sdk/state/persist.js";

afterEach(() => vi.unstubAllGlobals());

function runtimeConfig() {
    return {
        account_id: "test",
        token: "token",
        ilink_bot_id: "bot",
        base_url: "https://example.test",
        cdn_base_url: "https://cdn.example.test",
        bot_type: "3",
        qr_login: true,
    } as const;
}

describe("WechatIlinkBot 生命周期", () => {
    it("并发 start 共享一次初始化，stop 不允许旧轮询复活", async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL, init?: RequestInit) => {
                const url = String(input);
                calls.push(url);
                if (url.endsWith("getupdates")) {
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                            once: true,
                        });
                    });
                }
                return new Response("{}", { status: 200 });
            }),
        );
        const bot = new WechatIlinkBot(runtimeConfig(), {
            sessionStore: new MemoryCredentialStore(),
        });

        await Promise.all([bot.start(), bot.start()]);
        expect(calls.filter(url => url.endsWith("notifystart"))).toHaveLength(1);
        await bot.stop();
        expect(calls.filter(url => url.endsWith("notifystop"))).toHaveLength(1);
        await Promise.resolve();
        expect(calls.filter(url => url.endsWith("notifystart"))).toHaveLength(1);
    });

    it("stop 会取消进行中的扫码且不会启动轮询", async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL, init?: RequestInit) => {
                const url = String(input);
                calls.push(url);
                if (url.includes("get_bot_qrcode")) {
                    return new Response(
                        JSON.stringify({ qrcode: "qr", qrcode_img_content: "https://qr.test" }),
                    );
                }
                if (url.includes("get_qrcode_status")) {
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                            once: true,
                        });
                    });
                }
                return new Response("{}", { status: 200 });
            }),
        );
        const config = { ...runtimeConfig(), token: undefined, ilink_bot_id: undefined };
        const bot = new WechatIlinkBot(config, {
            sessionStore: new MemoryCredentialStore(),
        });
        const started = bot.start();
        await vi.waitFor(() =>
            expect(calls.some(url => url.includes("get_qrcode_status"))).toBe(true),
        );

        await bot.stop();
        await expect(started).resolves.toBeUndefined();
        expect(calls.some(url => url.endsWith("notifystart"))).toBe(false);
    });
});
