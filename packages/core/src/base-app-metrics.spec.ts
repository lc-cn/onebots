import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BaseApp } from "./base-app.js";

function listeningPort(app: BaseApp): number {
    const address = app.httpServer.address();
    return address && typeof address === "object" ? address.port : 0;
}

async function request(app: BaseApp, path: string): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${listeningPort(app)}${path}`);
    expect(response.status).toBe(200);
    return response.text();
}

describe("BaseApp metrics ownership", () => {
    it("每个应用只导出自身请求，停止一个应用不影响另一个应用", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const firstDirectory = mkdtempSync(join(tmpdir(), "onebots-metrics-first-"));
        const secondDirectory = mkdtempSync(join(tmpdir(), "onebots-metrics-second-"));
        let firstApp: BaseApp | undefined;
        let secondApp: BaseApp | undefined;

        try {
            process.env.PORT = "0";
            BaseApp.configDir = firstDirectory;
            firstApp = new BaseApp({ database: "first.db" });
            firstApp.router.get("/api/first-instance", ctx => {
                ctx.body = { ok: true };
            });

            BaseApp.configDir = secondDirectory;
            secondApp = new BaseApp({ database: "second.db" });
            secondApp.router.get("/api/second-instance", ctx => {
                ctx.body = { ok: true };
            });

            await firstApp.start();
            await secondApp.start();
            await request(firstApp, "/api/first-instance");
            await request(secondApp, "/api/second-instance");
            await request(secondApp, "/api/second-instance");

            const firstMetrics = await request(firstApp, "/metrics");
            const secondMetrics = await request(secondApp, "/metrics");
            expect(firstMetrics).toContain(
                'http_requests_total{method="GET",path="/api/first-instance"} 1',
            );
            expect(firstMetrics).not.toContain("/api/second-instance");
            expect(secondMetrics).toContain(
                'http_requests_total{method="GET",path="/api/second-instance"} 2',
            );
            expect(secondMetrics).not.toContain("/api/first-instance");

            await firstApp.stop();
            await request(secondApp, "/api/second-instance");
            const remainingMetrics = await request(secondApp, "/metrics");
            expect(remainingMetrics).toContain(
                'http_requests_total{method="GET",path="/api/second-instance"} 3',
            );
            await secondApp.stop();
        } finally {
            await firstApp?.stop();
            await secondApp?.stop();
            BaseApp.configDir = originalConfigDir;
            if (originalPort === undefined) delete process.env.PORT;
            else process.env.PORT = originalPort;
            rmSync(firstDirectory, { recursive: true, force: true });
            rmSync(secondDirectory, { recursive: true, force: true });
        }
    });
});
