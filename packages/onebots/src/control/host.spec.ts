import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
const gatewayEntrypoint = path.resolve(import.meta.dirname, "../../lib/gateway/entry.js");

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
    // macOS Unix domain socket paths are short; do not use the long user TMPDIR.
    const directory = fs.mkdtempSync("/tmp/ob-host-");
    directories.push(directory);
    return directory;
}

async function start(root: string, entrypoint = gatewayEntrypoint, runtimeRoot?: string) {
    const host = await startControlHost({
        workspace: root,
        port: 0,
        gatewayEntrypoint: entrypoint,
        runtimeRoot,
    });
    cleanups.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("控制宿主未监听 TCP");
    return {
        host,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        local: createLocalControlClient(root),
    };
}

async function pair(running: Awaited<ReturnType<typeof start>>) {
    const { code } = await running.local.bootstrap();
    let token = "";
    const client = new ControlClient(createHttpControlTransport(running.url, () => token));
    ({ token } = await client.pair(code));
    expect(token.length).toBeGreaterThanOrEqual(43);
    return client;
}

async function upgrade(port: number, target: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        let data = "";
        socket.setEncoding("utf8");
        socket.setTimeout(5_000, () => socket.destroy(new Error("升级请求未关闭")));
        socket.once("error", reject);
        socket.on("data", value => {
            data += value;
        });
        socket.once("end", () => {
            socket.destroy();
            resolve(data);
        });
        socket.once("connect", () =>
            socket.write(
                `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
            ),
        );
    });
}

describe("control host integration", () => {
    it("先查看平台Schema，再通过草稿添加账号和协议完成真实协议调用", async () => {
        const root = workspace();
        fs.writeFileSync(path.join(root, "config.yaml"), "plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\n  applications: []\n");
        const running = await start(root, gatewayEntrypoint, path.resolve("development"));
        const client = await pair(running);
        const snapshot = await client.configurationSnapshot();
        expect(snapshot.schemas.adapters).toHaveProperty("mock");
        const draft = await client.createConfigurationDraft(snapshot.base);
        const account = await client.addConfigurationAccount(draft.id, { expectedRevision: draft.revision, platform: "mock", accountId: "003.with.dot" });
        const protocol = await client.setConfigurationProtocol(draft.id, { expectedRevision: account.revision, accountKey: "mock.003.with.dot", protocol: "onebot.v11", enabled: true });
        const edited = await client.editConfigurationDraft(draft.id, { expectedRevision: protocol.revision, changes: [{ op: "set", path: ["mock.003.with.dot", "onebot.v11", "use_http"], value: true }], secrets: [] });
        const validation = await client.validateConfigurationDraft(draft.id, edited.revision);
        expect(validation.valid).toBe(true);
        expect((await client.applyConfiguration("account-api", validation.receiptId!)).status).toBe("succeeded");
        const response = await fetch(`${running.url}/mock/003.with.dot/onebot/v11/get_login_info`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        expect(response.status).toBe(200);
        expect((await response.json()).status).toBe("ok");
    });
    it("空白工作区通过统一HTTP客户端完成草稿校验应用，保持停止意图", async () => {
        const root = workspace();
        const running = await start(root);
        const client = await pair(running);
        await client.gateway("stop");
        const snapshot = await client.configurationSnapshot();
        expect(snapshot.document.plugins).toEqual({
            adapters: [],
            protocols: [],
            applications: [],
        });
        const draft = await client.createConfigurationDraft(snapshot.base);
        const edited = await client.editConfigurationDraft(draft.id, {
            expectedRevision: draft.revision,
            changes: [{ op: "set", path: ["log_level"], value: "debug" }],
            secrets: [],
        });
        const verified = await client.validateConfigurationDraft(draft.id, edited.revision);
        expect(verified.valid).toBe(true);
        expect(verified.receiptId).toBeTruthy();
        const operation = await client.applyConfiguration("http-config-apply", verified.receiptId!);
        expect(operation.status).toBe("succeeded");
        expect((await client.status()).gateway.desired).toBe("stopped");
        expect((await client.status()).gateway.actual).toBe("stopped");
        expect((await client.configurationSnapshot()).document.log_level).toBe("debug");
        expect(await client.applyConfiguration("http-config-apply", verified.receiptId!)).toEqual(
            operation,
        );
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await client.gateway("start")).status).toBe("succeeded");
    });
    it("配置应用记录损坏时保留管理端并拒绝启动，停止仍可执行", async () => {
        const root = workspace();
        const records = path.join(root, ".control/configuration-applications");
        fs.mkdirSync(records, { recursive: true });
        fs.writeFileSync(path.join(records, "broken.json"), '{"private-config-secret":');
        const running = await start(root);
        const client = await pair(running);
        const state = await client.status();
        expect(state.gateway.actual).not.toBe("running");
        expect(JSON.stringify(state)).not.toContain("private-config-secret");
        await expect(client.gateway("start")).rejects.toThrow();
        expect((await client.gateway("stop")).status).toBe("succeeded");
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await fetch(`${running.url}/ready`)).status).toBe(200);
        expect(fs.readFileSync(path.join(records, "broken.json"), "utf8")).toContain(
            "private-config-secret",
        );
    });
    it("网关ready后的状态写入失败仍保留Web并允许修复存储后安全关闭", async () => {
        const root = workspace();
        const entrypoint = path.join(root, "fault-gateway.mjs");
        fs.writeFileSync(
            entrypoint,
            `
import fs from 'node:fs';
import path from 'node:path';
process.on('disconnect', () => process.exit(0));
process.on('message', message => {
    if (message.type === 'gateway.stop') process.exit(0);
    const statePath = path.join(message.workspacePath, '.control/gateway.json');
    fs.renameSync(statePath, statePath + '.saved');
    fs.mkdirSync(statePath);
    process.send({...message, type:'gateway.ready', address:{host:'127.0.0.1',port:12345}});
});
`,
        );
        const running = await start(root, entrypoint);
        try {
            expect((await fetch(`${running.url}/`)).status).toBe(200);
            expect((await fetch(`${running.url}/ready`)).status).toBe(200);
            expect((await running.local.status()).gateway).toMatchObject({
                actual: "failed",
                recoveryRequired: true,
            });
        } finally {
            const statePath = path.join(root, ".control/gateway.json");
            fs.rmSync(statePath, { recursive: true });
            fs.renameSync(statePath + ".saved", statePath);
        }
        await running.host.close();
    });

    it("版本指针初始化失败不会关闭Web或启动未验证网关", async () => {
        const root = workspace();
        fs.mkdirSync(path.join(root, ".control"));
        fs.writeFileSync(path.join(root, ".control/active-generation.json"), "{invalid-pointer");
        const running = await start(root);
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await running.local.status()).gateway).toMatchObject({
            actual: "failed",
            recoveryRequired: true,
        });
        expect(running.host.controller.status().instance).toBeUndefined();
    });

    it("冷启动中断的版本切换阻止自动启动，但管理端可诊断", async () => {
        const root = workspace();
        fs.mkdirSync(path.join(root, ".control"));
        fs.writeFileSync(
            path.join(root, ".control/active-generation.json"),
            JSON.stringify({
                schemaVersion: 1,
                active: null,
                recoveryRequired: false,
                operations: [
                    {
                        id: "interrupted",
                        status: "running",
                        phase: "stopping",
                        previous: null,
                        target: { id: "target", planDigest: "a".repeat(64) },
                        desiredBefore: "running",
                        startedAt: new Date().toISOString(),
                    },
                ],
            }),
        );
        const running = await start(root);
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect(running.host.controller.status()).toMatchObject({
            actual: "stopped",
            desired: "running",
        });
        expect(running.host.controller.status().instance).toBeUndefined();
        await expect(running.local.gateway("start")).rejects.toThrow();
    });

    it("本地配对引导后 Web 控制真实网关，停止仍保留管理页且重启宿主维持停止意图", async () => {
        const root = workspace();
        const running = await start(root);
        const web = await pair(running);
        const initial = await web.status();
        expect(initial.gateway.actual).toBe("running");
        const firstId = initial.gateway.instance?.id;
        expect(firstId).toBeTruthy();
        expect(running.host.controller.status().instance?.pid).toBeGreaterThan(0);
        expect(running.host.controller.status().instance?.pid).not.toBe(process.pid);
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await fetch(`${running.url}/mock/bot/onebot/v11/get_login_info`)).status).toBe(404);
        expect(await web.gateway("stop")).toMatchObject({ status: "succeeded" });
        expect((await web.status()).gateway).toMatchObject({
            actual: "stopped",
            desired: "stopped",
        });
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await fetch(`${running.url}/ready`)).status).toBe(200);
        expect((await fetch(`${running.url}/mock/bot/onebot/v11/get_login_info`)).status).toBe(503);
        expect(await web.gateway("start")).toMatchObject({ status: "succeeded" });
        const secondId = (await web.status()).gateway.instance?.id;
        expect(secondId).not.toBe(firstId);
        expect(await web.gateway("restart")).toMatchObject({ status: "succeeded" });
        expect((await web.status()).gateway.instance?.id).not.toBe(secondId);
        expect(await running.local.gateway("stop")).toMatchObject({ status: "succeeded" });
        await running.host.close();
        const reopened = await start(root);
        expect((await reopened.local.status()).gateway).toMatchObject({
            actual: "stopped",
            desired: "stopped",
        });
        expect((await fetch(`${reopened.url}/`)).status).toBe(200);
        expect((await fetch(`${reopened.url}/ready`)).status).toBe(200);
    });

    it("坏配置不关闭管理端，修好后无需重启管理服务即可启动", async () => {
        const root = workspace();
        fs.writeFileSync(path.join(root, "config.yaml"), "[synthetic-secret");
        const running = await start(root);
        expect((await running.local.status()).gateway.actual).toBe("failed");
        expect(JSON.stringify(await running.local.status())).not.toContain("synthetic-secret");
        expect((await fetch(`${running.url}/`)).status).toBe(200);
        expect((await fetch(`${running.url}/ready`)).status).toBe(200);
        expect((await fetch(`${running.url}/protocol-endpoint`)).status).toBe(503);
        const web = await pair(running);
        fs.writeFileSync(
            path.join(root, "config.yaml"),
            "plugins:\n  adapters: []\n  protocols: []\n  applications: []\n",
        );
        expect(await web.gateway("start")).toMatchObject({ status: "succeeded" });
        expect((await web.status()).gateway.actual).toBe("running");
    });

    it("恢复历史 localhost 地址不能被 HTTP 或 WS 代理", async () => {
        const root = workspace();
        let requests = 0;
        const unrelated = http.createServer((_request, response) => {
            requests++;
            response.end("private local data");
        });
        unrelated.on("upgrade", (_request, socket) => {
            requests++;
            socket.end("HTTP/1.1 200 OK\r\n\r\n");
        });
        await new Promise<void>(resolve => unrelated.listen(0, "127.0.0.1", resolve));
        cleanups.push(
            () =>
                new Promise<void>((resolve, reject) =>
                    unrelated.close(error => (error ? reject(error) : resolve())),
                ),
        );
        const address = unrelated.address();
        if (!address || typeof address === "string") throw new Error("本地服务未监听");
        fs.mkdirSync(path.join(root, ".control"));
        fs.writeFileSync(
            path.join(root, ".control", "gateway.json"),
            JSON.stringify({
                schemaVersion: 1,
                desired: "running",
                actual: "running",
                recoveryRequired: false,
                instance: {
                    id: "old-instance",
                    pid: process.pid,
                    address: { host: "127.0.0.1", port: address.port },
                },
                operations: [],
            }),
        );
        const running = await start(root);
        expect((await running.local.status()).gateway.recoveryRequired).toBe(true);
        expect((await fetch(`${running.url}/private`)).status).toBe(503);
        expect(await upgrade(running.port, "/private")).toContain("503 Service Unavailable");
        expect(requests).toBe(0);
        expect((await fetch(`${running.url}/`)).status).toBe(200);
    });

    it("匿名 TCP 无法获取配对码或控制状态，非法 Upgrade 不影响管理服务", async () => {
        const running = await start(workspace());
        expect(
            (
                await fetch(`${running.url}/api/control/auth/bootstrap`, {
                    method: "POST",
                    body: "{}",
                })
            ).status,
        ).toBe(401);
        expect((await fetch(`${running.url}/api/control/status`)).status).toBe(401);
        expect(
            (await fetch(`${running.url}/api/control/gateway/stop`, { method: "POST", body: "{}" }))
                .status,
        ).toBe(401);
        expect(await upgrade(running.port, "http://[")).toContain("400 Bad Request");
        expect((await fetch(`${running.url}/ready`)).status).toBe(200);
        expect((await running.local.status()).gateway.actual).toBe("running");
    });
});
