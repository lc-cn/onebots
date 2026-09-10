import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMigrationManager, releaseMigrationManager } from "./service-migration-manager.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
});
function status() {
    return {
        schemaVersion: 1,
        manager: { id: randomUUID(), version: "1.2.3", pid: process.pid },
        accounts: {
            available: true,
            items: [{ platform: "mock", accountId: "bot", status: "online" as const }],
        },
        gateway: { desired: "stopped", actual: "stopped", recoveryRequired: false, operations: [] },
        serviceMigration: { pending: true, recoveryRequired: false },
    };
}
async function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-mig-mgr-"));
    const directory = path.join(root, ".control");
    fs.mkdirSync(directory, { mode: 0o700 });
    const socket = path.join(directory, "control.sock");
    const state: { body: unknown; code: number; mutate?: () => void } = {
        body: status(),
        code: 200,
    };
    const requests: Array<{ route: string; method: string; body: string }> = [];
    const server = http.createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", chunk => {
            body += chunk;
        });
        request.on("end", () => {
            requests.push({ route: request.url!, method: request.method!, body });
            state.mutate?.();
            response.writeHead(state.code, { "content-type": "application/json" });
            response.end(JSON.stringify(state.body));
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, resolve);
    });
    fs.chmodSync(socket, 0o600);
    cleanup.push(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        );
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, directory, socket, state, requests };
}
describe("迁移manager本地身份适配层", () => {
    it("读取真实私有Unix socket的结构化状态与PID，只投影已验证字段", async () => {
        const f = await fixture();
        const source = status();
        const instance = { id: randomUUID(), pid: 234, address: { host: "127.0.0.1", port: 8432 } };
        f.state.body = {
            ...source,
            secret: "never-return",
            gateway: {
                ...source.gateway,
                actual: "running",
                desired: "running",
                instance,
                operations: [{ error: "never-return" }],
            },
        };
        expect(await inspectMigrationManager(f.root)).toEqual({
            schemaVersion: 1,
            manager: source.manager,
            accounts: source.accounts,
            gateway: { desired: "running", actual: "running", recoveryRequired: false, instance },
            serviceMigration: source.serviceMigration,
            knownConfigurationFailure: false,
        });
        expect(f.requests).toEqual([{ route: "/api/control/status", method: "GET", body: "" }]);
    });
    it("release只发送精确操作ID，响应必须确认released且不能含附加字段", async () => {
        const f = await fixture();
        f.state.body = { released: true };
        await releaseMigrationManager(f.root, "migration_1");
        expect(f.requests).toEqual([
            {
                route: "/api/control/service-migration/release",
                method: "POST",
                body: '{"operationId":"migration_1"}',
            },
        ]);
        for (const body of [{ released: false }, { released: true, ignored: true }, {}, null]) {
            f.state.body = body;
            await expect(releaseMigrationManager(f.root, "migration_1")).rejects.toThrow(
                "状态无法确认",
            );
        }
        const count = f.requests.length;
        await expect(releaseMigrationManager(f.root, "../invalid")).rejects.toThrow();
        expect(f.requests).toHaveLength(count);
    });
    it("只有精确已知配置错误且无恢复要求或实例才能归类，原始错误不回传", async () => {
        const f = await fixture();
        for (const message of [
            "网关配置无法读取或解析，请检查工作区配置",
            "网关配置必须是 YAML 对象，管理服务仍可用于修复",
        ]) {
            const source = status();
            f.state.body = {
                ...source,
                gateway: { ...source.gateway, actual: "failed", error: message },
            };
            expect((await inspectMigrationManager(f.root)).knownConfigurationFailure).toBe(true);
            f.state.body = {
                ...source,
                gateway: {
                    ...source.gateway,
                    actual: "failed",
                    error: message,
                    recoveryRequired: true,
                },
            };
            expect((await inspectMigrationManager(f.root)).knownConfigurationFailure).toBe(false);
            f.state.body = {
                ...source,
                gateway: {
                    ...source.gateway,
                    actual: "failed",
                    error: message,
                    instance: {
                        id: randomUUID(),
                        pid: 234,
                        address: { host: "127.0.0.1", port: 8432 },
                    },
                },
            };
            expect((await inspectMigrationManager(f.root)).knownConfigurationFailure).toBe(false);
        }
        const source = status();
        f.state.body = {
            ...source,
            gateway: { ...source.gateway, actual: "failed", error: "secret failure" },
        };
        const result = await inspectMigrationManager(f.root);
        expect(result.knownConfigurationFailure).toBe(false);
        expect(JSON.stringify(result)).not.toContain("secret failure");
    });
    it("缺失身份、坏DTO、不完整实例和过大响应均拒绝且不泄漏服务端错误", async () => {
        const f = await fixture();
        const source = status();
        for (const body of [
            { ...source, schemaVersion: 2 },
            { ...source, manager: { ...source.manager, pid: 0 } },
            { ...source, manager: { id: source.manager.id, version: "1.2.3" } },
            { ...source, manager: { ...source.manager, id: "not-an-instance" } },
            { ...source, manager: { ...source.manager, version: "latest" } },
            { ...source, gateway: { ...source.gateway, actual: "running" } },
            { ...source, gateway: { ...source.gateway, desired: ["stopped"] } },
            { ...source, gateway: { ...source.gateway, actual: ["stopped"] } },
            {
                ...source,
                gateway: {
                    ...source.gateway,
                    instance: {
                        id: randomUUID(),
                        pid: 1,
                        address: { host: "example.com", port: 80 },
                    },
                },
            },
            { ...source, serviceMigration: { pending: "false", recoveryRequired: false } },
            { ...source, gateway: { ...source.gateway, recoveryRequired: null } },
            {
                ...source,
                accounts: {
                    available: true,
                    items: [{ platform: "mock", accountId: "bot", status: 1 }],
                },
            },
            {
                ...source,
                accounts: {
                    available: true,
                    items: [
                        { platform: "mock", accountId: "bot", status: "online", token: "secret" },
                    ],
                },
            },
            { ...source, accounts: { ...source.accounts, available: false } },
            { tooLarge: "x".repeat(1024 * 1024) },
        ]) {
            f.state.body = body;
            await expect(inspectMigrationManager(f.root)).rejects.toThrow(
                /^本地迁移管理服务状态无法确认，请保留现场并对账$/,
            );
        }
        f.state.code = 503;
        f.state.body = { message: "secret raw details" };
        await expect(inspectMigrationManager(f.root)).rejects.toThrow(
            /^本地迁移管理服务状态无法确认，请保留现场并对账$/,
        );
    });
    it("拒绝开放权限和链接socket，响应途中私有边界变化不当作可信成功", async () => {
        const f = await fixture();
        fs.chmodSync(f.socket, 0o666);
        await expect(inspectMigrationManager(f.root)).rejects.toThrow();
        expect(f.requests).toHaveLength(0);
        fs.chmodSync(f.socket, 0o600);
        fs.chmodSync(f.directory, 0o755);
        await expect(inspectMigrationManager(f.root)).rejects.toThrow();
        expect(f.requests).toHaveLength(0);
        fs.chmodSync(f.directory, 0o700);
        const original = f.socket + ".original";
        fs.renameSync(f.socket, original);
        fs.symlinkSync(original, f.socket);
        await expect(inspectMigrationManager(f.root)).rejects.toThrow();
        expect(f.requests).toHaveLength(0);
        fs.unlinkSync(f.socket);
        fs.renameSync(original, f.socket);
        f.state.mutate = () => fs.chmodSync(f.socket, 0o666);
        await expect(inspectMigrationManager(f.root)).rejects.toThrow();
        expect(f.requests).toHaveLength(1);
    });
});
