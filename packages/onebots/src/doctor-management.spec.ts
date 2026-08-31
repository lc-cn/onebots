import { describe, expect, it, vi } from "vitest";
import { probeDoctorManagement } from "./doctor-management.js";

describe("doctor management probes", () => {
    it("verifies anonymous rejection and authenticated access with a configured token", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            expect(input).toBe("http://127.0.0.1:6727/gateway/api/auth/me");
            const authorization = new Headers(init?.headers).get("authorization");
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
            ["management-ws-anonymous", "ok"],
            ["management-ws-authenticated", "ok"],
        ]);
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
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
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
            ["management-ws-anonymous", "ok"],
            ["management-ws-authenticated", "warning"],
        ]);
    });
});
