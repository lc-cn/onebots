import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeDoctorManagement } from "./doctor-management.js";
import { DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES } from "./doctor-management-response.js";
import packageMetadata from "../package.json" with { type: "json" };
import { buildAdapterCapabilityReport, summarizeManifest } from "./capability-report.js";
import { getInstallableAdapterNames } from "./extension-catalog-integrity.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import { TRUSTED_EXTENSION_CATALOG } from "./trusted-extension-catalog.js";

const capabilityEvidence = () => ({
    capabilityDeclared: true,
    capabilities: { version: 1, actions: {}, events: {}, segments: {}, transports: {} },
    accountCapabilities: {},
    accountCapabilityErrors: {},
});

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
                            ...capabilityEvidence(),
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
                    { status: 200, headers: managementIdentityHeaders() },
                );
            }
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
            if (input.endsWith("/api/adapter-capabilities")) {
                return completeCapabilityCatalogResponse();
            }
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
            {
                fetcher,
                upgrade,
                expectedIdentity: {
                    application: "onebots",
                    version: packageMetadata.version,
                    instanceId: "instance-a",
                },
            },
        );

        expect(checks.map(check => [check.name, check.level])).toEqual([
            ["management-http-anonymous", "ok"],
            ["management-http-authenticated", "ok"],
            ["management-config", "ok"],
            ["management-extensions", "ok"],
            ["management-capability-catalog", "ok"],
            ["management-runtime", "ok"],
            ["management-capabilities", "ok"],
            ["management-ws-anonymous", "ok"],
            ["management-ws-authenticated", "ok"],
        ]);
        expect(checks.find(check => check.name === "management-runtime")?.message).toBe(
            "运行态已验证: 1 个账号，1 个协议出口均就绪",
        );
        expect(checks.find(check => check.name === "management-capabilities")?.message).toBe(
            "能力证据已验证: 1 个适配器默认清单与 1 个账号能力均可信",
        );
        expect(
            checks.find(check => check.name === "management-capability-catalog")?.identity,
        ).toEqual({
            application: "onebots",
            version: packageMetadata.version,
            instanceId: "instance-a",
        });
        expect(checks.find(check => check.name === "management-extensions")?.message).toBe(
            "扩展运行证据已验证: 0 个已启用，0 个已加载，版本均已收敛",
        );
        expect(upgrade).toHaveBeenNthCalledWith(1, "http://127.0.0.1:6727/");
        expect(upgrade).toHaveBeenNthCalledWith(2, "http://127.0.0.1:6727/", "secret");
    });

    it("拒绝把其他实例的账号运行态拼接到公开探针", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) {
                return new Response("[]", {
                    status: 200,
                    headers: managementIdentityHeaders("instance-b"),
                });
            }
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
            if (input.endsWith("/api/adapter-capabilities")) {
                return completeCapabilityCatalogResponse();
            }
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
                expectedIdentity: {
                    application: "onebots",
                    version: packageMetadata.version,
                    instanceId: "instance-a",
                },
            },
        );

        expect(checks.find(check => check.name === "management-runtime")).toMatchObject({
            level: "error",
            message: expect.stringContaining("instance-b"),
        });
        expect(checks.find(check => check.name === "management-capabilities")).toMatchObject({
            level: "error",
            message: expect.stringContaining("管理运行态响应不可用"),
        });
    });

    it("starts every independent configured-token probe before a slow peer completes", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const started = new Set<string>();
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            const authorization = new Headers(init?.headers).has("authorization");
            const name = input.endsWith("/api/adapters")
                ? "runtime"
                : input.endsWith("/api/adapter-capabilities")
                  ? "capability-catalog"
                  : input.endsWith("/api/system")
                    ? "config"
                    : input.endsWith("/api/extensions/package-mutation")
                      ? "package-mutation"
                      : input.endsWith("/api/extensions")
                        ? "extensions"
                        : authorization
                          ? "http-authenticated"
                          : "http-anonymous";
            started.add(name);
            await gate;
            if (name === "runtime") return new Response("[]", { status: 200 });
            if (name === "capability-catalog") return completeCapabilityCatalogResponse();
            if (name === "config") return inSyncSystemResponse();
            if (name === "package-mutation") return idlePackageMutationResponse();
            if (name === "extensions") return convergedExtensionsResponse();
            return authorization
                ? new Response(JSON.stringify({ success: true }), { status: 200 })
                : new Response(null, { status: 401 });
        });
        const upgrade = vi.fn(async (_url: string, token?: string) => {
            started.add(token ? "ws-authenticated" : "ws-anonymous");
            await gate;
            return token ? { upgraded: true, status: 101 } : { upgraded: false, status: 401 };
        });

        const probing = probeDoctorManagement(
            "http://127.0.0.1:6727",
            { access_token: "secret" },
            { fetcher, upgrade },
        );
        await vi.waitFor(() => {
            expect([...started].sort()).toEqual([
                "capability-catalog",
                "config",
                "extensions",
                "http-anonymous",
                "http-authenticated",
                "package-mutation",
                "runtime",
                "ws-anonymous",
                "ws-authenticated",
            ]);
        });
        release();

        const checks = await probing;
        expect(checks.map(check => check.name)).toEqual([
            "management-http-anonymous",
            "management-http-authenticated",
            "management-config",
            "management-extensions",
            "management-capability-catalog",
            "management-runtime",
            "management-capabilities",
            "management-ws-anonymous",
            "management-ws-authenticated",
        ]);
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
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
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

    it("拒绝超限登录响应且不继续发送认证信息", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/auth/login")) {
                return oversizedManagementResponse();
            }
            expect(new Headers(init?.headers).has("authorization")).toBe(false);
            return new Response(null, { status: 401 });
        });
        const upgrade = vi.fn(async (_url: string, token?: string) => ({
            upgraded: false,
            status: token ? 500 : 401,
        }));

        const checks = await probeDoctorManagement(
            "http://127.0.0.1:6727",
            { username: "operator", password: "password" },
            { fetcher, upgrade },
        );

        expect(checks.find(check => check.name === "management-http-authenticated")).toEqual({
            name: "management-http-authenticated",
            level: "error",
            message: "管理登录不可达: 响应正文超过 4 MiB 上限",
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(upgrade).toHaveBeenCalledTimes(1);
    });

    it("将超限运行态响应隔离为运行态与能力诊断错误", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) return oversizedManagementResponse();
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
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

        expect(checks.find(check => check.name === "management-runtime")).toMatchObject({
            level: "error",
            message: expect.stringContaining("响应正文超过 4 MiB 上限"),
        });
        expect(checks.find(check => check.name === "management-capabilities")).toMatchObject({
            level: "error",
            message: expect.stringContaining("响应正文超过 4 MiB 上限"),
        });
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
            ["management-extensions", "warning"],
            ["management-capability-catalog", "warning"],
            ["management-runtime", "warning"],
            ["management-capabilities", "warning"],
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
                            ...capabilityEvidence(),
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

    it("fails the production capability check without hiding healthy lifecycle evidence", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) {
                return new Response(
                    JSON.stringify([
                        {
                            platform: "custom",
                            ...capabilityEvidence(),
                            accountCapabilityErrors: {
                                bot: {
                                    code: "capability_unavailable",
                                    message: "传输模式无效",
                                },
                            },
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

        expect(checks.find(check => check.name === "management-runtime")).toMatchObject({
            level: "ok",
        });
        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "账号能力证据不可用: custom.bot: 传输模式无效",
        });
    });

    it("fails capability verification for a loaded zero-account adapter with an unknown manifest", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) {
                return new Response(
                    JSON.stringify([
                        {
                            platform: "third-party",
                            ...capabilityEvidence(),
                            capabilityDeclared: false,
                            accounts: [],
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

        expect(checks.find(check => check.name === "management-runtime")).toMatchObject({
            level: "ok",
            message: expect.stringContaining("0 个账号"),
        });
        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "账号能力证据不可用: third-party: 适配器默认能力清单未声明",
        });
    });

    it("rejects malformed capability diagnostics as an invalid management contract", async () => {
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) {
                return new Response(
                    JSON.stringify([
                        {
                            platform: "custom",
                            ...capabilityEvidence(),
                            accountCapabilityErrors: {
                                ghost: { code: "unknown", message: "ignored" },
                            },
                            accounts: [],
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

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "适配器能力契约无效: custom.ghost 不对应已配置账号",
        });
    });

    it("proves a loaded adapter default manifest without pretending an account exists", async () => {
        const checks = await probeWithAdapters([
            { platform: "mock", ...capabilityEvidence(), accounts: [] },
        ]);

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "ok",
            message: "能力证据已验证: 1 个适配器默认清单有效，尚未配置账号",
        });
    });

    it("rejects a claimed capability declaration without a concrete manifest", async () => {
        const checks = await probeWithAdapters([
            {
                platform: "custom",
                capabilityDeclared: true,
                accountCapabilities: {},
                accountCapabilityErrors: {},
                accounts: [],
            },
        ]);

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "适配器能力契约无效: custom 默认能力清单无效: 适配器能力清单必须是对象",
        });
    });

    it("rejects account capability overrides that cannot be tied to configured accounts", async () => {
        const evidence = capabilityEvidence();
        const checks = await probeWithAdapters([
            {
                platform: "custom",
                ...evidence,
                accountCapabilities: { ghost: evidence.capabilities },
                accounts: [],
            },
        ]);

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "适配器能力契约无效: custom.ghost 的能力覆写不对应已配置账号",
        });
    });

    it("rejects malformed account capability manifests", async () => {
        const evidence = capabilityEvidence();
        const checks = await probeWithAdapters([
            {
                platform: "custom",
                ...evidence,
                accountCapabilities: {
                    bot: {
                        ...evidence.capabilities,
                        actions: { send_message: { support: "unknown" } },
                    },
                },
                accounts: [{ uin: "bot", status: "online", protocols: [] }],
            },
        ]);

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message:
                "适配器能力契约无效: custom.bot 账号能力清单无效: 适配器能力 actions.send_message 的 support 无效",
        });
    });

    it("rejects contradictory account capability evidence", async () => {
        const evidence = capabilityEvidence();
        const checks = await probeWithAdapters([
            {
                platform: "custom",
                ...evidence,
                accountCapabilities: { bot: evidence.capabilities },
                accountCapabilityErrors: {
                    bot: { code: "capability_unavailable", message: "读取失败" },
                },
                accounts: [{ uin: "bot", status: "online", protocols: [] }],
            },
        ]);

        expect(checks.find(check => check.name === "management-capabilities")).toEqual({
            name: "management-capabilities",
            level: "error",
            message: "适配器能力契约无效: custom.bot 同时声明能力覆写和不可用诊断",
        });
    });

    it("uses the same deployment token precedence as the running gateway", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-token");
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/api/adapters")) return new Response("[]", { status: 200 });
            if (input.endsWith("/api/system")) return inSyncSystemResponse();
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
            if (input.endsWith("/api/adapter-capabilities")) {
                return completeCapabilityCatalogResponse();
            }
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
            if (input.endsWith("/api/extensions/package-mutation")) {
                return idlePackageMutationResponse();
            }
            if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
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

async function probeWithAdapters(adapters: unknown[]) {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/api/adapters")) {
            return new Response(JSON.stringify(adapters), { status: 200 });
        }
        if (input.endsWith("/api/system")) return inSyncSystemResponse();
        if (input.endsWith("/api/extensions/package-mutation")) {
            return idlePackageMutationResponse();
        }
        if (input.endsWith("/api/extensions")) return convergedExtensionsResponse();
        return new Headers(init?.headers).has("authorization")
            ? new Response(JSON.stringify({ success: true }), { status: 200 })
            : new Response(null, { status: 401 });
    });
    return probeDoctorManagement(
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
}

function convergedExtensionsResponse(): Response {
    const inventory = TRUSTED_EXTENSION_CATALOG.map(entry => {
        const packageEntry = getExtensionPackageCatalogEntry(entry.packageName);
        if (!packageEntry) throw new Error(`测试目录缺少 ${entry.packageName}`);
        const capability =
            entry.type === "adapter" ? getExtensionCapabilityCatalogEntry(entry.name) : undefined;
        if (entry.type === "adapter" && !capability) {
            throw new Error(`测试目录缺少 ${entry.name} 能力`);
        }
        return {
            ...structuredClone(entry),
            catalogError: null,
            runtimeError: null,
            packageManagerError: null,
            runtimeConfigError: null,
            configurationError: null,
            targetVersion: packageEntry.packageVersion,
            installedVersion: null,
            installedError: null,
            versionAligned: false,
            installed: false,
            enabled: false,
            loaded: false,
            loadedVersion: null,
            restartSupported: true,
            installing: false,
            installation: null,
            lastInstallation: null,
            capability: capability
                ? {
                      source: "catalog",
                      status: "verified",
                      packageVersion: capability.packageVersion,
                      declared: true,
                      summary: summarizeManifest(capability.manifest),
                      manifest: capability.manifest,
                  }
                : null,
        };
    });
    return new Response(JSON.stringify(inventory), {
        status: 200,
        headers: managementIdentityHeaders(),
    });
}

function completeCapabilityCatalogResponse(): Response {
    return new Response(
        JSON.stringify({
            schemaVersion: 1,
            generatedAt: "2026-09-01T00:00:00.000Z",
            application: {
                name: packageMetadata.name,
                version: packageMetadata.version,
                instanceId: "instance-a",
            },
            ...buildAdapterCapabilityReport([], [], getInstallableAdapterNames()),
        }),
        { status: 200 },
    );
}

function idlePackageMutationResponse(): Response {
    return new Response(
        JSON.stringify({ state: "idle", available: true, owner: null, error: null }),
        { status: 200, headers: managementIdentityHeaders() },
    );
}

function managementIdentityHeaders(instanceId = "instance-a"): Record<string, string> {
    return {
        "X-OneBots-Application": packageMetadata.name,
        "X-OneBots-Version": packageMetadata.version,
        "X-OneBots-Instance-Id": instanceId,
    };
}

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

function oversizedManagementResponse(): Response {
    return new Response("", {
        status: 200,
        headers: {
            "content-length": String(DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES + 1),
        },
    });
}
