import { describe, expect, it, vi } from "vitest";
import { probeHealth, probeReadiness } from "./service-probes.js";

function readiness(
    ready: boolean,
    options: {
        configured?: boolean;
        totalAccounts?: number;
        onlineAccounts?: number;
        totalProtocols?: number;
        readyProtocols?: number;
        accountsWithoutProtocols?: number;
        configInSync?: boolean;
    } = {},
) {
    return new Response(
        JSON.stringify({
            ready,
            configured: options.configured ?? true,
            server: true,
            reloading: false,
            config: {
                status: options.configInSync === false ? "drifted" : "in_sync",
                in_sync: options.configInSync ?? true,
            },
            summary: {
                total_accounts: options.totalAccounts ?? 1,
                online_accounts: options.onlineAccounts ?? 1,
                total_protocols: options.totalProtocols ?? 1,
                ready_protocols: options.readyProtocols ?? 1,
                accounts_without_protocols: options.accountsWithoutProtocols ?? 0,
            },
        }),
        { status: ready ? 200 : 503 },
    );
}

function stalledJsonResponse(): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
        },
    });
    return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

describe("Web semantic service probes", () => {
    it("requires health semantics and OneBots identity instead of HTTP success alone", async () => {
        const valid = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        status: "ok",
                        application: "onebots",
                        version: "1.2.3",
                        instance_id: "instance-1",
                    }),
                ),
        );
        const invalid = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok", application: "other" })),
        );

        await expect(probeHealth(valid)).resolves.toMatchObject({
            state: "success",
            label: "正常",
            detail: "OneBots 1.2.3，实例 instance-1",
        });
        await expect(probeHealth(invalid)).resolves.toMatchObject({
            state: "danger",
            label: "证据无效",
        });
    });

    it("distinguishes a manageable first deployment from production readiness", async () => {
        const result = await probeReadiness(
            vi.fn(async () =>
                readiness(true, {
                    configured: false,
                    totalAccounts: 0,
                    onlineAccounts: 0,
                    totalProtocols: 0,
                    readyProtocols: 0,
                }),
            ),
        );

        expect(result).toEqual({
            state: "warning",
            label: "待配置",
            detail: "服务可管理，尚未配置机器人账号",
        });
    });

    it("reports account and protocol evidence for a production-ready service", async () => {
        await expect(probeReadiness(vi.fn(async () => readiness(true)))).resolves.toEqual({
            state: "success",
            label: "生产就绪",
            detail: "账号 1/1 在线，协议出口 1/1 就绪",
        });
    });

    it("keeps protocol and configuration failures visible when an account is online", async () => {
        const result = await probeReadiness(
            vi.fn(async () =>
                readiness(false, {
                    totalProtocols: 1,
                    readyProtocols: 0,
                    accountsWithoutProtocols: 1,
                    configInSync: false,
                }),
            ),
        );

        expect(result).toMatchObject({ state: "danger", label: "未就绪" });
        expect(result.detail).toContain("账号 1/1 在线");
        expect(result.detail).toContain("协议出口 0/1 就绪");
        expect(result.detail).toContain("1 个账号没有协议出口");
        expect(result.detail).toContain("配置状态 drifted");
    });

    it("rejects contradictory HTTP and JSON evidence", async () => {
        const response = readiness(true);
        const contradictory = new Response(await response.text(), { status: 503 });

        await expect(probeReadiness(vi.fn(async () => contradictory))).resolves.toEqual({
            state: "danger",
            label: "证据无效",
            detail: "ready=true 与 HTTP 503 不一致",
        });
    });

    it("rejects internally contradictory readiness counts", async () => {
        await expect(
            probeReadiness(
                vi.fn(async () =>
                    readiness(true, {
                        totalAccounts: 1,
                        onlineAccounts: 2,
                    }),
                ),
            ),
        ).resolves.toMatchObject({ state: "danger", label: "证据无效" });
    });

    it("reports malformed and unreachable probes as unknown", async () => {
        await expect(
            probeReadiness(vi.fn(async () => new Response(JSON.stringify({ ready: true })))),
        ).resolves.toMatchObject({ state: "danger", label: "证据无效" });
        await expect(
            probeReadiness(vi.fn(async () => Promise.reject(new Error("connection refused")))),
        ).resolves.toEqual({
            state: "danger",
            label: "就绪未知",
            detail: "ready 不可达：connection refused",
        });
    });

    it("bounds stalled health and readiness requests with explicit evidence", async () => {
        const healthFetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
        const readinessFetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));

        await expect(probeHealth(healthFetcher, 5)).resolves.toEqual({
            state: "danger",
            label: "存活未知",
            detail: "health 探测超时（5ms）",
        });
        await expect(probeReadiness(readinessFetcher, 5)).resolves.toEqual({
            state: "danger",
            label: "就绪未知",
            detail: "ready 探测超时（5ms）",
        });
        expect(healthFetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        expect(readinessFetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it("also bounds a response whose headers arrive but JSON body never completes", async () => {
        await expect(
            probeHealth(
                vi.fn(async () => stalledJsonResponse()),
                5,
            ),
        ).resolves.toMatchObject({
            state: "danger",
            detail: "health 探测超时（5ms）",
        });
        await expect(
            probeReadiness(
                vi.fn(async () => stalledJsonResponse()),
                5,
            ),
        ).resolves.toMatchObject({
            state: "danger",
            detail: "ready 探测超时（5ms）",
        });
    });
});
