import { describe, expect, it, vi } from "vitest";
import { checkReadiness, readinessUrl } from "../../scripts/docker-healthcheck.mjs";

describe("Docker healthcheck", () => {
    it("resolves the configured port and normalized path", () => {
        expect(readinessUrl({ port: 7000, path: "/gateway/" }, {})).toBe(
            "http://127.0.0.1:7000/gateway/ready",
        );
        expect(
            readinessUrl({ port: 7000, path: "ignored" }, { PORT: "7860", ONEBOTS_PATH: "hf" }),
        ).toBe("http://127.0.0.1:7860/hf/ready");
        expect(
            readinessUrl(
                { port: 7000, path: "ignored" },
                { ONEBOTS_HEALTHCHECK_URL: "http://127.0.0.1:9000/custom-ready" },
            ),
        ).toBe("http://127.0.0.1:9000/custom-ready");
    });

    it("accepts only readiness evidence owned by a concrete OneBots instance", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: true,
                        application: "onebots",
                        version: "1.2.3",
                        instance_id: "container-instance",
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            checkReadiness({
                env: { PORT: "6727", ONEBOTS_PATH: "gateway" },
                config: {},
                fetcher,
            }),
        ).resolves.toBeUndefined();
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/gateway/ready",
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it("fails on non-success status or an ambiguous success body", async () => {
        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => new Response('{"ready":false}', { status: 503 }),
            }),
        ).rejects.toThrow(/HTTP 503/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => new Response('{"status":"ok"}', { status: 200 }),
            }),
        ).rejects.toThrow(/ready=true/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    new Response('{"ready":true,"application":"onebots","version":"1.2.3"}', {
                        status: 200,
                    }),
            }),
        ).rejects.toThrow(/instance_id/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    new Response(
                        '{"ready":true,"application":"other","version":"1.2.3","instance_id":"instance"}',
                        { status: 200 },
                    ),
            }),
        ).rejects.toThrow(/onebots 应用身份/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => new Response("not-json", { status: 200 }),
            }),
        ).rejects.toThrow(/未返回 JSON/);
    });
});
