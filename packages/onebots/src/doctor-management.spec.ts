import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeDoctorManagement } from "./doctor-management.js";

describe("doctor management probes", () => {
    beforeEach(() => vi.stubEnv("ONEBOTS_ACCESS_TOKEN", ""));
    afterEach(() => vi.unstubAllEnvs());

    it("verifies anonymous rejection and authenticated access with a configured token", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            const authorization = new Headers(init?.headers).get("authorization");
            if (input.endsWith("/api/adapters")) {
                expect(authorization).toBe("Bearer secret");
                return new Response(
                    JSON.stringify([
                        {
                            platform: "mock",
                            accounts: [
                                {
                                    uin: "bot",
                                    status: "online",
                                    protocols: [
                                        {
                                            name: "onebot",
                                            version: "v11",
                                            lifecycleStatus: "ready",
                                        },
                                    ],
                                },
                            ],
                        },
                    ]),
                    { status: 200 },
                );
            }
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            expect(input).toBe("http://127.0.0.1:6727/gateway/api/auth/me");
            return authorization
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response("Unauthorized", { status: 401 });
        });
        const upgrade = vi.fn(async (_url: string, token?: string) =>
            token ? { upgraded: true, status: 101 } : { upgraded: false, status: 401 },
        );

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727/gateway",
            { access_token: "secret" },
            { fetcher, upgrade },
        );

        expect(checks.map(check => [check.name, check.level])).toEqual([
            ["management-http-anonymous", "ok"],
            ["management-http-authenticated", "ok"],
            ["management-config", "ok"],
            ["management-runtime", "ok"],
            ["management-ws-anonymous", "ok"],
            ["management-ws-authenticated", "ok"],
        ]);
        expect(checks.find(check => check.name === "management-runtime")?.message).toBe(
            "运行态已验证: 1 个账号，1 个协议出口均就绪",
        );
        expect(upgrade).toHaveBeenNthCalledWith(1, "http://127.0.0.1:6727/");
        expect(upgrade).toHaveBeenNthCalledWith(2, "http://127.0.0.1:6727/", "secret");
    });

    it("logs in with configured credentials and revokes the temporary session", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/auth/login")) {
                expect(JSON.parse(String(init?.body))).toEqual({
                    username: "operator",
                    password: "password",
                });
                return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
            }
            if (input.endsWith("/api/auth/logout")) return new Response(null, { status: 200 });
            if (input.endsWith("/api/adapters")) return new Response("[]", { status: 200 });
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            return new Headers(init?.headers).has("authorization")
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response(null, { status: 401 });
        });
        const upgrade = vi.fn(async (_url: string, token?: string) => ({
            upgraded: !!token,
            status: token ? 101 : 401,
        }));

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { username: "operator", password: "password" },
            { fetcher, upgrade },
        );

        expect(checks.at(-1)).toEqual({
            name: "management-session-cleanup",
            level: "ok",
            message: "诊断会话令牌已撤销",
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/api/auth/logout",
            expect.objectContaining({
                method: "POST",
                headers: { authorization: "Bearer session-token" },
            }),
        );
    });

    it("fails when either anonymous management boundary is exposed", async () => {
        const fetcher = vi.fn(async (input: string) =>
            input.endsWith("/api/adapters")
                ? new Response("[]", { status: 200 })
                : input.endsWith("/api/system")
                  ? inSyncSystemResponse()
                  : new Response(JSON.stringify({ success: true }), { status: 200 }),
        );
        const upgrade = vi.fn(async () => ({ upgraded: true, status: 101 }));

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { access_token: "secret" },
            { fetcher, upgrade },
        );

        expect(checks.find(check => check.name === "management-http-anonymous")).toMatchObject({
            level: "error",
            message: "管理 API 未按预期拒绝匿名请求: HTTP 200",
        });
        expect(checks.find(check => check.name === "management-ws-anonymous")).toMatchObject({
            level: "error",
            message: "管理 WebSocket 错误接受了匿名升级",
        });
    });

    it("keeps anonymous protection verifiable when credentials were generated at startup", async () => {
        const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
        const upgrade = vi.fn(async () => ({ upgraded: false, status: 401 }));

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            {},
            { fetcher, upgrade },
        );

        expect(checks.map(check => [check.name, check.level])).toEqual([
            ["management-http-anonymous", "ok"],
            ["management-http-authenticated", "warning"],
            ["management-config", "warning"],
            ["management-runtime", "warning"],
            ["management-ws-anonymous", "ok"],
            ["management-ws-authenticated", "warning"],
        ]);
    });

    it("identifies the exact account and protocol outlet behind readiness failure", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) {
                expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
                return new Response(
                    JSON.stringify([
                        {
                            platform: "kook",
                            accounts: [
                                {
                                    uin: "primary",
                                    status: "offline",
                                    protocols: [
                                        {
                                            name: "onebot",
                                            version: "v11",
                                            lifecycleStatus: "failed",
                                        },
                                    ],
                                },
                                { uin: "orphan", status: "online", protocols: [] },
                            ],
                        },
                    ]),
                    { status: 200 },
                );
            }
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            return new Headers(init?.headers).has("authorization")
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response(null, { status: 401 });
        });

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { access_token: "secret" },
            {
                fetcher,
                upgrade: async (_url, token) => ({
                    upgraded: Boolean(token),
                    status: token ? 101 : 401,
                }),
            },
        );

        expect(checks.find(check => check.name === "management-runtime")).toEqual({
            name: "management-runtime",
            level: "error",
            message:
                "运行态未就绪: kook.primary 账号状态 offline；kook.primary/onebot.v11 协议状态 failed；kook.orphan 无协议出口",
        });
    });

    it("uses the same deployment token precedence as the running gateway", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-token");
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) return new Response("[]", { status: 200 });
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            return new Headers(init?.headers).get("authorization") === "Bearer deployment-token"
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response(null, { status: 401 });
        });

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { access_token: "file-token" },
            {
                fetcher,
                upgrade: async (_url, token) => ({
                    upgraded: token === "deployment-token",
                    status: token === "deployment-token" ? 101 : 401,
                }),
            },
        );

        expect(checks.every(check => check.level === "ok")).toBe(true);
        expect(fetcher).not.toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ headers: { authorization: "Bearer file-token" } }),
        );
    });

    it("fails when the online process has not applied the current disk config", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/system")) {
                return new Response(
                    JSON.stringify({
                        configState: {
                            status: "drifted",
                            appliedAt: "2026-08-31T10:00:00.000Z",
                        },
                    }),
                    { status: 200 },
                );
            }
            if (input.endsWith("/api/adapters")) return new Response("[]", { status: 200 });
            return new Headers(init?.headers).has("authorization")
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response(null, { status: 401 });
        });

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { access_token: "secret" },
            {
                fetcher,
                upgrade: async (_url, token) => ({
                    upgraded: Boolean(token),
                    status: token ? 101 : 401,
                }),
            },
        );

        expect(checks.find(check => check.name === "management-config")).toEqual({
            name: "management-config",
            level: "error",
            message:
                "磁盘配置与在线进程已应用的版本不一致（应用时间 2026-08-31T10:00:00.000Z）；请重新加载或重启",
        });
    });
});

function inSyncSystemResponse(): Response {
    return new Response(
        JSON.stringify({
            configState: {
                status: "in_sync",
                appliedAt: "2026-08-31T09:00:00.000Z",
            },
        }),
        { status: 200 },
    );
}
