import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { controlSocket, acquireControlWorkspace } from "./workspace.js";
import { createLocalControlClient } from "../client/local-control.js";
import { prepareServiceMigrationWorkspace } from "../service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "../service-migration-processes.js";

const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
async function start(workspace: string) {
    const host = await startControlHost({
        workspace,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    let closed = false;
    const close = async () => {
        if (!closed) {
            await host.close();
            closed = true;
        }
    };
    cleanups.push(close);
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("未监听TCP");
    return { close, url: "http://127.0.0.1:" + address.port };
}
function localPost(
    workspace: string,
    route: string,
    body: unknown,
): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                socketPath: controlSocket(workspace),
                path: route,
                method: "POST",
                headers: { "content-type": "application/json" },
            },
            response => {
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 1024 * 1024) {
                        response.destroy(new Error("响应过大"));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("error", reject);
                response.on("end", () => {
                    try {
                        resolve({
                            status: response.statusCode ?? 0,
                            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        );
        request.setTimeout(5000, () => request.destroy(new Error("本地请求超时")));
        request.on("error", reject);
        request.end(JSON.stringify(body));
    });
}
async function setup(damaged = false) {
    const root = fs.mkdtempSync("/tmp/ob-mig-host-");
    directories.push(root);
    const operationId = "migration-host-test";
    prepareServiceMigrationWorkspace(root, operationId, "stopped");
    const release = acquireControlWorkspace(root);
    try { prepareServiceProcessOwnershipSeed(fs.realpathSync(root)); }
    finally { release(); }
    const marker = path.join(root, ".control/migration-pending.json");
    if (damaged) fs.writeFileSync(marker, '{"private-marker-secret":');
    const running = await start(root);
    const { code } = await createLocalControlClient(root).bootstrap();
    let token = "";
    const client = new ControlClient(createHttpControlTransport(running.url, () => token));
    ({ token } = await client.pair(code));
    expect(token.length).toBeGreaterThanOrEqual(43);
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    const post = (route: string, body: unknown = {}) =>
        fetch(running.url + route, { method: "POST", headers, body: JSON.stringify(body) });
    const status = () =>
        fetch(running.url + "/api/control/status", { headers }).then(response => response.json());
    return { root, operationId, marker, running, client, token, post, status };
}
describe("系统服务迁移管理宿主门禁", () => {
    it("保持stopped并可配对，仅本地精确确认开放写入，重启不丢停止意图", async () => {
        const f = await setup();
        expect((await fetch(f.running.url + "/ready")).status).toBe(200);
        expect(
            (await fetch(f.running.url + "/api/control/gateway/start", { method: "POST" })).status,
        ).toBe(401);
        const status = await f.status();
        expect(status.serviceMigration).toEqual({ pending: true, recoveryRequired: false });
        expect(status.gateway).toMatchObject({ desired: "stopped", actual: "stopped" });
        expect(JSON.stringify(status)).not.toContain(f.operationId);
        for (const route of [
            "gateway/start",
            "gateway/stop",
            "gateway/restart",
            "configuration/drafts",
            "installations/plan",
        ])
            expect(
                (await f.post("/api/control/" + route, { unexpected: "do-not-dispatch" })).status,
                route,
            ).toBe(423);
        expect((await localPost(f.root, "/api/control/gateway/start", {})).status).toBe(423);
        const release = "/api/control/service-migration/release";
        // loopback TCP + 有效会话仍不是本机socket。
        expect((await f.post(release, { operationId: f.operationId })).status).toBe(403);
        for (const body of [
            { operationId: "wrong-operation" },
            { operationId: f.operationId, extra: true },
            {},
        ])
            expect((await localPost(f.root, release, body)).status).toBe(409);
        expect(fs.existsSync(f.marker)).toBe(true);
        expect(await localPost(f.root, release, { operationId: f.operationId })).toEqual({
            status: 200,
            body: { released: true },
        });
        expect(fs.existsSync(f.marker)).toBe(false);
        expect((await f.client.gateway("stop")).status).toBe("succeeded");
        expect((await f.status()).serviceMigration).toEqual({
            pending: false,
            recoveryRequired: false,
        });
        await f.running.close();
        const restarted = await start(f.root);
        const restored = new ControlClient(
            createHttpControlTransport(restarted.url, () => f.token),
        );
        expect((await restored.status()).gateway).toMatchObject({
            desired: "stopped",
            actual: "stopped",
        });
        expect((await fetch(restarted.url + "/ready")).status).toBe(200);
        expect((await restored.gateway("stop")).status).toBe("succeeded");
    });
    it("损坏marker保持管理在线但拒绝所有写入，秘密不进入状态响应", async () => {
        const f = await setup(true);
        expect((await fetch(f.running.url + "/ready")).status).toBe(200);
        const status = await f.status();
        expect(status.serviceMigration).toEqual({ pending: true, recoveryRequired: true });
        expect(status.gateway.actual).not.toBe("running");
        expect(JSON.stringify(status)).not.toContain("private-marker-secret");
        for (const route of ["gateway/start", "configuration/drafts", "installations/plan"])
            expect((await f.post("/api/control/" + route)).status).toBe(423);
        expect(
            (
                await localPost(f.root, "/api/control/service-migration/release", {
                    operationId: f.operationId,
                })
            ).status,
        ).toBe(409);
        expect(fs.readFileSync(f.marker, "utf8")).toBe('{"private-marker-secret":');
    });
});
