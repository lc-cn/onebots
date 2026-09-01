import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BaseApp } from "./base-app.js";

function auditEvents(directory: string): Array<{ path: string; type: string }> {
    const auditDirectory = join(directory, "data", "audit");
    return readdirSync(auditDirectory).flatMap(file =>
        readFileSync(join(auditDirectory, file), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line) as { path: string; type: string }),
    );
}

function listeningPort(app: BaseApp): number {
    const address = app.httpServer.address();
    return address && typeof address === "object" ? address.port : 0;
}

describe("BaseApp security audit ownership", () => {
    it("停止一个应用后不会关闭或重定向另一个应用的审计流", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalPort = process.env.PORT;
        const firstDirectory = mkdtempSync(join(tmpdir(), "onebots-audit-first-"));
        const secondDirectory = mkdtempSync(join(tmpdir(), "onebots-audit-second-"));
        let firstApp: BaseApp | undefined;
        let secondApp: BaseApp | undefined;

        try {
            process.env.PORT = "0";
            BaseApp.configDir = firstDirectory;
            firstApp = new BaseApp({ database: "first.db" });
            firstApp.router.get("/api/audit-boundary", ctx => {
                ctx.body = { ok: true };
            });

            BaseApp.configDir = secondDirectory;
            secondApp = new BaseApp({ database: "second.db" });
            secondApp.router.get("/api/audit-boundary", ctx => {
                ctx.body = { ok: true };
            });

            await firstApp.start();
            await secondApp.start();
            await expect(
                fetch(`http://127.0.0.1:${listeningPort(firstApp)}/api/audit-boundary`).then(
                    response => response.status,
                ),
            ).resolves.toBe(200);
            await expect(
                fetch(`http://127.0.0.1:${listeningPort(secondApp)}/api/audit-boundary`).then(
                    response => response.status,
                ),
            ).resolves.toBe(200);

            await firstApp.stop();
            await expect(
                fetch(`http://127.0.0.1:${listeningPort(secondApp)}/api/audit-boundary`).then(
                    response => response.status,
                ),
            ).resolves.toBe(200);
            await secondApp.stop();

            expect(auditEvents(firstDirectory)).toEqual([
                expect.objectContaining({ path: "/api/audit-boundary", type: "auth_success" }),
            ]);
            expect(auditEvents(secondDirectory)).toEqual([
                expect.objectContaining({ path: "/api/audit-boundary", type: "auth_success" }),
                expect.objectContaining({ path: "/api/audit-boundary", type: "auth_success" }),
            ]);
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
