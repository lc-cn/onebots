import { afterEach, describe, expect, it, vi } from "vitest";
import { conventionSessionPath, WechatIlinkBot } from "./bot.js";
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
    it("会话路径对特殊账号 ID 保持单射，不会串用凭证", () => {
        expect(conventionSessionPath("a/b")).not.toBe(conventionSessionPath("a_b"));
        expect(conventionSessionPath("a%2Fb")).not.toBe(conventionSessionPath("a/b"));
        expect(conventionSessionPath("a/b")).toContain("a%2Fb.json");
    });

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

    it("扫码支持 IDC 跳转与 Web 数字配对码", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL, init?: RequestInit) => {
                const url = String(input);
                calls.push({ url, init });
                if (url.includes("get_bot_qrcode")) {
                    return new Response(
                        JSON.stringify({ qrcode: "qr", qrcode_img_content: "https://qr.test" }),
                    );
                }
                if (url.includes("get_qrcode_status") && url.startsWith("https://example.test")) {
                    return new Response(
                        JSON.stringify({
                            status: "scaned_but_redirect",
                            redirect_host: "idc.example.test",
                        }),
                    );
                }
                if (url.includes("get_qrcode_status") && !url.includes("verify_code=")) {
                    return new Response(JSON.stringify({ status: "need_verifycode" }));
                }
                if (url.includes("get_qrcode_status")) {
                    return new Response(
                        JSON.stringify({
                            status: "confirmed",
                            bot_token: "new-token",
                            ilink_bot_id: "new-bot",
                            baseurl: "https://api.example.test",
                        }),
                    );
                }
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
        const config = { ...runtimeConfig(), token: undefined, ilink_bot_id: undefined };
        const bot = new WechatIlinkBot(config, {
            sessionStore: new MemoryCredentialStore(),
        });
        const verificationRequired = vi.fn(() => bot.submitVerificationCode("1234"));
        bot.on("verification_code_required", verificationRequired);

        await bot.start();
        expect(verificationRequired).toHaveBeenCalledOnce();
        expect(
            calls.some(
                call =>
                    call.url.startsWith("https://idc.example.test") &&
                    call.url.includes("verify_code=1234"),
            ),
        ).toBe(true);
        expect(
            calls.some(call => call.url === "https://api.example.test/ilink/bot/msg/notifystart"),
        ).toBe(true);
        await bot.stop();
    });
});
