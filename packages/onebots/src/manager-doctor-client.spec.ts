import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { inspectManagerDiagnostics } from "./manager-doctor-client.js";
import { controlSocket } from "./control/workspace.js";
const roots: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function dto() {
    return {
        schemaVersion: 1,
        manager: { id: randomUUID(), pid: process.pid, version: "1.2.3" },
        management: { host: "127.0.0.1", port: 6727 },
        gateway: { actual: "stopped", desired: "stopped", recoveryRequired: false },
        configuration: { state: "ready", recoveryRequired: false },
        generation: { activeId: null, recoveryRequired: false },
        storage: {
            dataDirectory: "creatable",
            database: "creatable",
            publicStatic: "disabled",
            databaseIntegrity: "not-checked",
        },
        extensions: { receipt: "bundled", selection: "ready", registration: "not-checked" },
        processOwnership: { available: true },
        serviceMigration: { pending: false, recoveryRequired: false },
    };
}
async function listen(server: http.Server, socket: string): Promise<void> {
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, () => {
            server.off("error", reject);
            resolve();
        });
    });
    fs.chmodSync(socket, 0o600);
}
async function fixture(handler: http.RequestListener) {
    const workspace = fs.realpathSync(fs.mkdtempSync("/tmp/ob-dc-"));
    roots.push(workspace);
    fs.chmodSync(workspace, 0o700);
    fs.mkdirSync(path.join(workspace, ".control"), { mode: 0o700 });
    const socket = controlSocket(workspace);
    await listen(http.createServer(handler), socket);
    return { workspace, socket };
}
describe("private doctor diagnostics socket", () => {
    it("sends only a fixed unauthenticated GET and accepts a closed DTO", async () => {
        const value = dto();
        const requests: Array<{
            method?: string;
            url?: string;
            authorization?: string;
            body: string;
        }> = [];
        const f = await fixture((request, response) => {
            let body = "";
            request.on("data", chunk => {
                body += chunk;
            });
            request.on("end", () => {
                requests.push({
                    method: request.method,
                    url: request.url,
                    authorization: request.headers.authorization,
                    body,
                });
                response.end(JSON.stringify(value));
            });
        });
        expect(await inspectManagerDiagnostics(f.workspace)).toEqual(value);
        expect(requests).toEqual([
            { method: "GET", url: "/api/control/diagnostics", authorization: undefined, body: "" },
        ]);
    });
    it.each(["secret", "extra", "missing-management"])("rejects %s fields", async kind => {
        const value: Record<string, unknown> = dto();
        if (kind === "missing-management") delete value.management;
        else if (kind === "secret")
            value.configuration = {
                state: "ready",
                recoveryRequired: false,
                token: "synthetic-secret",
            };
        else value.extra = true;
        const f = await fixture((_request, response) => response.end(JSON.stringify(value)));
        await expect(inspectManagerDiagnostics(f.workspace)).rejects.toThrow();
    });
    it("accepts explicit null management without treating missing as null", async () => {
        const f = await fixture((_request, response) =>
            response.end(JSON.stringify({ ...dto(), management: null })),
        );
        expect((await inspectManagerDiagnostics(f.workspace)).management).toBeNull();
    });
    it.each([401, 500])("rejects HTTP %s without using its body", async status => {
        const f = await fixture((_request, response) => {
            response.statusCode = status;
            response.end("synthetic-secret");
        });
        await expect(inspectManagerDiagnostics(f.workspace)).rejects.toThrow(/^管理诊断不可用$/);
    });
    it("rejects an oversized response", async () => {
        const f = await fixture((_request, response) => response.end("x".repeat(65537)));
        await expect(inspectManagerDiagnostics(f.workspace)).rejects.toThrow("响应过大");
    });
    it("rejects a socket replaced while the original connection supplies a valid response", async () => {
        const value = dto();
        let replacementFailed: unknown;
        const f = await fixture((_request, response) => {
            void (async () => {
                try {
                    fs.renameSync(f.socket, `${f.socket}.original`);
                    await listen(
                        http.createServer((_incoming, outgoing) => outgoing.end("{}")),
                        f.socket,
                    );
                    response.end(JSON.stringify(value));
                } catch (error) {
                    replacementFailed = error;
                    response.destroy();
                }
            })();
        });
        await expect(inspectManagerDiagnostics(f.workspace)).rejects.toThrow("管理实例已变化");
        expect(replacementFailed).toBeUndefined();
    });
});
