import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    checkReadiness,
    DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES,
    DOCKER_EXPECTED_APPLICATION_VERSION,
    readinessUrl,
} from "../../scripts/docker-healthcheck.mjs";

function jsonResponse(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("Docker healthcheck", () => {
    it("uses the manager PORT and root ready, ignoring legacy routing overrides", () => {
        expect(readinessUrl({})).toBe("http://127.0.0.1:6727/ready");
        expect(
            readinessUrl({
                PORT: "7860",
                ONEBOTS_PATH: "business",
                ONEBOTS_HEALTHCHECK_URL: "http://other/custom",
            }),
        ).toBe("http://127.0.0.1:7860/ready");
        for (const PORT of ["", "0", "65536", "invalid", "6727/path", "2.5"])
            expect(() => readinessUrl({ PORT })).toThrow("管理端口无效");
    });

    it("never parses broken YAML or uses a business port/path as manager readiness", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-health-"));
        try {
            const file = path.join(directory, "config.yaml");
            const fetcher = vi.fn(async (_url: string) =>
                jsonResponse(
                    JSON.stringify({
                        ready: true,
                        application: "onebots",
                        version: DOCKER_EXPECTED_APPLICATION_VERSION,
                        instance_id: "manager",
                    }),
                ),
            );
            for (const content of ["secret: [broken", "port: 7000\npath: /business\n"]) {
                fs.writeFileSync(file, content);
                await checkReadiness({
                    env: { PORT: "7860", ONEBOTS_CONFIG_PATH: file, ONEBOTS_PATH: "/business" },
                    fetcher,
                });
            }
            expect(fetcher).toHaveBeenCalledTimes(2);
            expect(
                fetcher.mock.calls.every(call => call[0] === "http://127.0.0.1:7860/ready"),
            ).toBe(true);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("accepts only readiness evidence owned by a concrete OneBots instance", async () => {
        const fetcher = vi.fn(async () =>
            jsonResponse(
                JSON.stringify({
                    ready: true,
                    application: "onebots",
                    version: DOCKER_EXPECTED_APPLICATION_VERSION,
                    instance_id: "container-instance",
                }),
            ),
        );

        await expect(
            checkReadiness({
                env: { PORT: "6727", ONEBOTS_PATH: "gateway" },
                fetcher,
            }),
        ).resolves.toBeUndefined();
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/ready",
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
                env: {},
                fetcher: async () => jsonResponse('{"ready":false}', 503),
            }),
        ).rejects.toThrow(/HTTP 503/);

        await expect(
            checkReadiness({
                env: {},
                fetcher: async () => jsonResponse('{"status":"ok"}'),
            }),
        ).rejects.toThrow(/ready=true/);

        await expect(
            checkReadiness({
                env: {},
                fetcher: async () =>
                    jsonResponse(
                        JSON.stringify({
                            ready: true,
                            application: "onebots",
                            version: DOCKER_EXPECTED_APPLICATION_VERSION,
                        }),
                    ),
            }),
        ).rejects.toThrow(/instance_id/);

        await expect(
            checkReadiness({
                env: {},
                fetcher: async () =>
                    jsonResponse(
                        JSON.stringify({
                            ready: true,
                            application: "onebots",
                            version: "0.0.0-stale",
                            instance_id: "stale-instance",
                        }),
                    ),
            }),
        ).rejects.toThrow(
            `运行版本不匹配（期望 ${DOCKER_EXPECTED_APPLICATION_VERSION}，实际 0.0.0-stale）`,
        );

        await expect(
            checkReadiness({
                env: {},
                fetcher: async () =>
                    jsonResponse(
                        '{"ready":true,"application":"other","version":"1.2.3","instance_id":"instance"}',
                    ),
            }),
        ).rejects.toThrow(/onebots 应用身份/);

        await expect(
            checkReadiness({
                env: {},
                fetcher: async () => jsonResponse("not-json"),
            }),
        ).rejects.toThrow(/未返回 JSON/);
    });

    it("rejects incorrect media and bounded-body violations", async () => {
        await expect(
            checkReadiness({
                env: {},
                fetcher: async () => new Response("<html></html>", { status: 200 }),
            }),
        ).rejects.toThrow(/Content-Type 不是 application\/json/);

        await expect(
            checkReadiness({
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
