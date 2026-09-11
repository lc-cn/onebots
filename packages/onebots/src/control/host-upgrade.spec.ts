import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { startControlHost } from "./host.js";
import { controlSocket } from "./workspace.js";
import { createLocalControlClient } from "../client/local-control.js";
import {
    prepareManagerUpgradeWorkspace,
    readManagerUpgradePending,
} from "../service-upgrade-workspace.js";
const roots: string[] = [];
const hosts: Array<Awaited<ReturnType<typeof startControlHost>>> = [];
afterEach(async () => {
    for (const host of hosts.splice(0)) await host.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const pending = {
    schemaVersion: 1 as const,
    operationId: "upgrade-test",
    candidateDigest: "a".repeat(64),
};
async function initial() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upg-"));
    roots.push(root);
    const options = {
        workspace: root,
        host: "127.0.0.1",
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    };
    const host = await startControlHost(options);
    hosts.push(host);
    const client = createLocalControlClient(root);
    await client.pair((await client.bootstrap()).code);
    return { root, options, host };
}
it("持锁管理服务仍运行时不能写升级标记", async () => {
    const { root } = await initial();
    await expect(prepareManagerUpgradeWorkspace(root, pending)).rejects.toThrow();
    expect(readManagerUpgradePending(root)).toBeNull();
});
it.each(["running", "stopped"] as const)(
    "已有%s意图跨两次维护启动保持停止，配置与认证不被重写",
    async desired => {
        const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upg-"));
        roots.push(root);
        const options = {
            workspace: root,
            host: "127.0.0.1",
            port: 0,
            gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
        };
        const entry = path.join(root, "original.mjs");
        const hostModule = pathToFileURL(
            path.resolve(import.meta.dirname, "../../lib/control/host.js"),
        ).href;
        fs.writeFileSync(
            entry,
            `import { startControlHost } from ${JSON.stringify(hostModule)};
const host = await startControlHost(${JSON.stringify(options)});
process.once("message", async () => { await host.close(); process.exit(0); });
process.send({ ready: true });`,
        );
        const child = fork(entry, [], {
            execArgv: [],
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const exited = once(child, "exit");
        try {
            await once(child, "message");
            const client = createLocalControlClient(root);
            expect((await client.status()).gateway.actual).toBe("running");
            await client.pair((await client.bootstrap()).code);
            if (desired === "stopped") await client.gateway("stop");
        } finally {
            child.send("close");
            expect((await exited)[0]).toBe(0);
        }
        const f = { root, options };
        const files = ["config.yaml", ".control/auth.json", ".control/gateway.json"];
        const before = files.map(file => fs.readFileSync(path.join(f.root, file)));
        await prepareManagerUpgradeWorkspace(f.root, pending);
        expect(files.map(file => fs.readFileSync(path.join(f.root, file)))).toEqual(before);
        await expect(prepareManagerUpgradeWorkspace(f.root, pending)).rejects.toThrow();
        for (let index = 0; index < 2; index++) {
            const host = await startControlHost(f.options);
            hosts.push(host);
            const local = createLocalControlClient(f.root);
            const status = await local.status();
            expect(status.gateway).toMatchObject({ desired, actual: "stopped" });
            expect(status.serviceMigration.pending).toBe(true);
            await expect(local.gateway("start")).rejects.toThrow();
            const response = await new Promise<number>(resolve => {
                const request = http.request(
                    {
                        socketPath: controlSocket(f.root),
                        path: "/api/control/service-migration/release",
                        method: "POST",
                    },
                    response => {
                        response.resume();
                        resolve(response.statusCode!);
                    },
                );
                request.end(JSON.stringify({ operationId: pending.operationId }));
            });
            expect(response).toBe(423);
            expect(readManagerUpgradePending(f.root)).toEqual(pending);
            await host.close();
            hosts.pop();
        }
        expect(files.slice(0, 2).map(file => fs.readFileSync(path.join(f.root, file)))).toEqual(
            before.slice(0, 2),
        );
    },
);
it("损坏的升级标记阻止自动启动与写操作，保留管理状态读取", async () => {
    const f = await initial();
    await f.host.close();
    hosts.pop();
    fs.writeFileSync(path.join(f.root, ".control/manager-upgrade-pending.json"), "{", {
        mode: 0o600,
    });
    const host = await startControlHost(f.options);
    hosts.push(host);
    const local = createLocalControlClient(f.root);
    const status = await local.status();
    expect(host.controller.status().actual).toBe("stopped");
    expect(status.gateway.recoveryRequired).toBe(true);
    expect(status.serviceMigration).toEqual({ pending: true, recoveryRequired: true });
    await expect(local.gateway("start")).rejects.toThrow();
});
