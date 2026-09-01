import { describe, expect, it, vi } from "vitest";
import {
    checkReadiness,
    DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES,
    readinessUrl,
} from "../../scripts/docker-healthcheck.mjs";

function jsonResponse(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
    });
}

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
        const fetcher = vi.fn(async () =>
            jsonResponse(
                JSON.stringify({
                    ready: true,
                    application: "onebots",
                    version: "1.2.3",
                    instance_id: "container-instance",
                }),
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
            expect.objectContaining({
                cache: "no-store",
                headers: { accept: "application/json" },
                redirect: "error",
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it("fails on non-success status or an ambiguous success body", async () => {
        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => jsonResponse('{"ready":false}', 503),
            }),
        ).rejects.toThrow(/HTTP 503/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => jsonResponse('{"status":"ok"}'),
            }),
        ).rejects.toThrow(/ready=true/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    jsonResponse('{"ready":true,"application":"onebots","version":"1.2.3"}'),
            }),
        ).rejects.toThrow(/instance_id/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    jsonResponse(
                        '{"ready":true,"application":"other","version":"1.2.3","instance_id":"instance"}',
                    ),
            }),
        ).rejects.toThrow(/onebots 应用身份/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => jsonResponse("not-json"),
            }),
        ).rejects.toThrow(/未返回 JSON/);
    });

    it("rejects incorrect media and bounded-body violations", async () => {
        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () => new Response("<html></html>", { status: 200 }),
            }),
        ).rejects.toThrow(/Content-Type 不是 application\/json/);

        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    new Response(null, {
                        status: 200,
                        headers: {
                            "content-type": "application/json",
                            "content-length": String(DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES + 1),
                        },
                    }),
            }),
        ).rejects.toThrow(/超过 65536 字节上限/);

        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new Uint8Array(DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES + 1));
            },
            cancel() {
                cancelled = true;
            },
        });
        await expect(
            checkReadiness({
                config: {},
                env: {},
                fetcher: async () =>
                    new Response(stream, {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    }),
            }),
        ).rejects.toThrow(/超过 65536 字节上限/);
        expect(cancelled).toBe(true);
    });
});
