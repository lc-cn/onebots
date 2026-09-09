import { afterEach, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { GatewayRequestClient } from "../control/gateway-request-client.js";
import { requestGatewayMessageDebug } from "../control/gateway-message-debug-client.js";
import { requestGatewayVerification } from "../control/gateway-verification-client.js";
import type { GatewayStartMessage } from "./contracts.js";

const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

function spawnGatedGateway(holdProtocol = false) {
    const workspace = mkdtempSync(path.join(tmpdir(), "onebots-managed-startup-"));
    directories.push(workspace);
    if (holdProtocol) writeFileSync(path.join(workspace, "hold-protocol"), "hold");
    const core = JSON.stringify(pathToFileURL(path.resolve("packages/core/lib/index.js")).href);
    function extension(name: string, source: string) {
        const directory = path.join(workspace, "node_modules", "@onebots", name);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({
                name: `@onebots/${name}`,
                version: "0.0.0",
                type: "module",
                main: "index.js",
            }),
        );
        writeFileSync(path.join(directory, "index.js"), source);
    }
    extension(
        "adapter-gated",
        `
        import { Account, Adapter, AdapterRegistry } from ${core};
        import { existsSync, writeFileSync } from "node:fs";
        class GatedAdapter extends Adapter {
            constructor(app) { super(app, "gated"); }
            submitVerification(id, type, data) {
                if (data.code !== "123456") throw new Error("测试验证码错误");
                writeFileSync("release-account", "release");
            }
            createAccount(config) {
                const account = new Account(this, {}, config);
                this.app.router.get(account.path + "/callback", ctx => {
                    ctx.body = { callback: "available" };
                });
                account.on("start", signal => new Promise((resolve, reject) => {
                    writeFileSync("account-started", "pending");
                    this.emit("verification:request", {
                        platform: "gated", account_id: config.account_id, type: "pair_code", hint: "测试验证码",
                        options: { blocks: [{ type: "input", key: "code", secret: true, maxLength: 8 }] },
                    });
                    let timer;
                    const abort = () => {
                        clearInterval(timer);
                        writeFileSync("account-aborted", "aborted");
                        reject(new DOMException("测试启动已取消", "AbortError"));
                    };
                    if (signal.aborted) { abort(); return; }
                    signal.addEventListener("abort", abort, { once: true });
                    timer = setInterval(() => {
                        if (!existsSync("release-account")) return;
                        clearInterval(timer);
                        signal.removeEventListener("abort", abort);
                        writeFileSync("account-released", "released");
                        resolve();
                    }, 10);
                }));
                account.on("stop", () => writeFileSync("account-stopped", "stopped"));
                return account;
            }
        }
        AdapterRegistry.register("gated", GatedAdapter);
        AdapterRegistry.registerSchema("gated", {});
    `,
    );
    extension(
        "protocol-gated-v1",
        `
        import { Protocol, ProtocolRegistry } from ${core};
        import { existsSync, writeFileSync } from "node:fs";
        class GatedProtocol extends Protocol {
            name = "gated";
            version = "v1";
            constructor(adapter, account, config) {
                super(adapter, account, { ...config, protocol: "gated", version: "v1" });
            }
            async start(signal) {
                this.router.get(this.path + "/status", ctx => {
                    ctx.body = { lifecycleStatus: this.lifecycleStatus };
                });
                writeFileSync("protocol-started", "started");
                if (!existsSync("hold-protocol")) return;
                await new Promise((resolve, reject) => {
                    let timer;
                    const abort = () => {
                        clearInterval(timer);
                        reject(new DOMException("测试协议启动已取消", "AbortError"));
                    };
                    if (signal.aborted) { abort(); return; }
                    signal.addEventListener("abort", abort, { once: true });
                    timer = setInterval(() => {
                        if (!existsSync("release-protocol")) return;
                        clearInterval(timer);
                        signal.removeEventListener("abort", abort);
                        resolve();
                    }, 10);
                });
            }
            stop() {}
            dispatch() {}
            format(event, payload) { return payload; }
            async apply() { return {}; }
        }
        ProtocolRegistry.register("gated", "v1", GatedProtocol);
        ProtocolRegistry.registerSchema("gated.v1", {});
    `,
    );
    const configPath = path.join(workspace, "snapshot.yaml");
    writeFileSync(configPath, "port: 6727\ngeneral: {}\ngated.bot:\n  gated.v1: {}\n");
    const child = fork(path.resolve("packages/onebots/lib/gateway/entry.js"), [], {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(child);
    let output = "";
    child.stdout?.on("data", chunk => {
        output += String(chunk);
    });
    child.stderr?.on("data", chunk => {
        output += String(chunk);
    });
    const messages: unknown[] = [];
    child.on("message", message => messages.push(message));
    const identity = {
        protocolVersion: 1 as const,
        controlInstanceId: randomUUID(),
        gatewayInstanceId: randomUUID(),
    };
    const message: GatewayStartMessage = {
        type: "gateway.start",
        ...identity,
        configVersion: "config-gated",
        dependencyVersion: "dependencies-gated",
        configPath,
        workspacePath: workspace,
        selection: { adapters: ["gated"], protocols: ["gated-v1"], applications: [] },
    };
    return { workspace, child, message, identity, messages, output: () => output };
}

describe("实际构建网关分阶段就绪", () => {
    it("通过私有验证IPC提交原挑战后，等待中的账号与协议继续启动", async () => {
        const { child, message, identity, workspace } = spawnGatedGateway();
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready.type).toBe("gateway.ready");
        const requests = new GatewayRequestClient(child, 3000);
        const context = { ...identity, configVersion: message.configVersion };
        try {
            const snapshot = await requestGatewayVerification(requests, context, {
                action: "list",
            });
            if (snapshot.action !== "list" || snapshot.outcome !== "succeeded")
                throw new Error("缺少验证挑战");
            expect(snapshot.challenges).toHaveLength(1);
            const operation = {
                action: "execute" as const,
                command: {
                    operationId: randomUUID(),
                    challengeId: snapshot.challenges[0].id,
                    expected: {
                        gatewayInstanceId: identity.gatewayInstanceId,
                        configVersion: message.configVersion,
                    },
                    action: "submit" as const,
                    data: { code: "123456" },
                },
            };
            expect(await requestGatewayVerification(requests, context, operation)).toMatchObject({
                outcome: "succeeded",
            });
            expect(await requestGatewayVerification(requests, context, operation)).toMatchObject({
                outcome: "succeeded",
            });
            await expect
                .poll(async () => {
                    const response = await fetch(
                        `http://127.0.0.1:${ready.address.port}/gated/bot/gated/v1/status`,
                    );
                    return response.status === 200 ? response.json() : null;
                })
                .toEqual({ lifecycleStatus: "ready" });
            expect(
                await requestGatewayVerification(requests, context, { action: "list" }),
            ).toMatchObject({ challenges: [] });
            expect(readFileSync(path.join(workspace, "release-account"), "utf8")).toBe("release");
        } finally {
            requests.close();
            const exited = once(child, "exit");
            child.send({ type: "gateway.stop", ...identity, timeoutMs: 3000 });
            expect((await exited)[0]).toBe(0);
        }
    });
    it("账号等待交互时管理 IPC 已可用，释放后才启动协议", async () => {
        const { workspace, child, message, identity, messages, output } = spawnGatedGateway();
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready, output()).toMatchObject({ type: "gateway.ready", ...identity });
        await expect.poll(() => existsSync(path.join(workspace, "account-started"))).toBe(true);
        expect(existsSync(path.join(workspace, "account-released"))).toBe(false);
        expect(existsSync(path.join(workspace, "protocol-started"))).toBe(false);
        const url = `http://127.0.0.1:${ready.address.port}/gated/bot/gated/v1/status`;
        expect((await fetch(url)).status).toBe(404);
        const requests = new GatewayRequestClient(child, 3000);
        try {
            expect(await requestGatewayMessageDebug(requests, identity, "history")).toMatchObject({
                outcome: "succeeded",
                result: { entries: [] },
            });
            writeFileSync(path.join(workspace, "release-account"), "release");
            await expect
                .poll(() => existsSync(path.join(workspace, "protocol-started")))
                .toBe(true);
            const response = await fetch(url);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ lifecycleStatus: "ready" });
        } finally {
            requests.close();
            const exited = once(child, "exit");
            child.send({ type: "gateway.stop", ...identity, timeoutMs: 3000 });
            expect((await exited)[0]).toBe(0);
        }
        expect(
            messages.filter(
                value =>
                    typeof value === "object" &&
                    value !== null &&
                    "type" in value &&
                    value.type === "gateway.failed",
            ),
        ).toEqual([]);
    });

    it("协议异步启动期间闸门返回 503，平台回调仍可访问", async () => {
        const { workspace, child, message, identity, output } = spawnGatedGateway(true);
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready, output()).toMatchObject({ type: "gateway.ready", ...identity });
        const baseUrl = `http://127.0.0.1:${ready.address.port}`;
        writeFileSync(path.join(workspace, "release-account"), "release");
        await expect.poll(() => existsSync(path.join(workspace, "protocol-started"))).toBe(true);
        try {
            expect((await fetch(`${baseUrl}/gated/bot/gated/v1/status`)).status).toBe(503);
            const callback = await fetch(`${baseUrl}/gated/bot/callback`);
            expect(callback.status).toBe(200);
            expect(await callback.json()).toEqual({ callback: "available" });
            writeFileSync(path.join(workspace, "release-protocol"), "release");
            await expect
                .poll(async () => {
                    const response = await fetch(`${baseUrl}/gated/bot/gated/v1/status`);
                    return response.status === 200 ? response.json() : { status: response.status };
                })
                .toEqual({ lifecycleStatus: "ready" });
        } finally {
            const exited = once(child, "exit");
            child.send({ type: "gateway.stop", ...identity, timeoutMs: 3000 });
            expect((await exited)[0]).toBe(0);
        }
    });

    it("停止等待交互的启动会取消账号且正常退出，不产生 START_FAILED", async () => {
        const { workspace, child, message, identity, messages, output } = spawnGatedGateway();
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready.type, output()).toBe("gateway.ready");
        await expect.poll(() => existsSync(path.join(workspace, "account-started"))).toBe(true);
        const exited = once(child, "exit");
        child.send({ type: "gateway.stop", ...identity, timeoutMs: 3000 });
        expect((await exited)[0]).toBe(0);
        expect(readFileSync(path.join(workspace, "account-aborted"), "utf8")).toBe("aborted");
        expect(readFileSync(path.join(workspace, "account-stopped"), "utf8")).toBe("stopped");
        expect(existsSync(path.join(workspace, "protocol-started"))).toBe(false);
        expect(
            messages.filter(
                value =>
                    typeof value === "object" &&
                    value !== null &&
                    "type" in value &&
                    value.type === "gateway.failed",
            ),
        ).toEqual([]);
    });
});
