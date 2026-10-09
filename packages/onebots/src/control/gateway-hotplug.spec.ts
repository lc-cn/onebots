import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import yaml from "js-yaml";
import { expect, it } from "vitest";
import { NodeGatewayDriver } from "./gateway-driver.js";
import { prepareGatewayWorkspace } from "./workspace.js";
import { createGatewayConfigurationSnapshot } from "./gateway-configuration-snapshot.js";

it("真实网关热改协议与账号，未涉及的 WS 保持连接且新版本控制入口可用", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-hotplug-")));
    const config = {
        log_level: "off",
        plugins: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
        general: {},
        "mock.a": { auto_events: false, "onebot.v11": { use_http: true, use_ws: true } },
        "mock.b": { auto_events: false, "onebot.v11": { use_http: true, use_ws: true } },
    };
    fs.writeFileSync(path.join(root, "config.yaml"), yaml.dump(config), { mode: 0o600 });
    const modules = path.join(root, "node_modules", "@onebots");
    fs.mkdirSync(modules, { recursive: true });
    for (const [name, directory] of [
        ["adapter-mock", "adapters/adapter-mock"],
        ["protocol-onebot-v11", "protocols/onebot-v11/protocol"],
    ])
        fs.symlinkSync(path.resolve(directory), path.join(modules, name), "dir");
    const driver = new NodeGatewayDriver({
        controlInstanceId: randomUUID(),
        onExit: () => {},
        prepare: async () => ({
            ...prepareGatewayWorkspace(root, root),
            entrypoint: path.resolve("packages/onebots/lib/gateway/entry.js"),
        }),
    });
    let socket: WebSocket | undefined;
    let instance;
    try {
        instance = await driver.start();
        const origin = `http://127.0.0.1:${instance.address!.port}`;
        const login = async (account: string, token = "") => {
            const response = await fetch(`${origin}/mock/${account}/onebot/v11/get_login_info`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: "{}",
            });
            return response.status;
        };
        await expect.poll(() => login("b"), { timeout: 10_000 }).toBe(200);
        await expect
            .poll(
                () => {
                    const status = driver.accountStatuses(instance!.id);
                    return (
                        status.available &&
                        status.items.length === 2 &&
                        status.items.every(account => account.status === "online")
                    );
                },
                { timeout: 10_000 },
            )
            .toBe(true);
        socket = new WebSocket(`${origin.replace("http:", "ws:")}/mock/b/onebot/v11/api`);
        await once(socket, "open");
        const before = driver.runtimeContext(instance.id)!;
        const next = {
            ...config,
            "mock.a": {
                ...config["mock.a"],
                "onebot.v11": { use_http: true, use_ws: true, access_token: "isolated-test-token" },
            },
        };
        const snapshot = createGatewayConfigurationSnapshot(root, next);
        const input = {
            id: randomUUID(),
            expected: before,
            nextConfigVersion: snapshot.configVersion,
            configPath: snapshot.configPath,
        };
        expect(await driver.applyRuntimeConfiguration(input)).toEqual({
            status: "applied",
            configVersion: snapshot.configVersion,
        });
        expect(socket.readyState).toBe(WebSocket.OPEN);
        expect(await login("b")).toBe(200);
        expect(await login("a", "isolated-test-token")).toBe(200);
        expect(await login("a")).toBe(401);
        expect(await driver.queryRuntimeConfiguration({ id: input.id, expected: before })).toEqual({
            status: "applied",
            configVersion: snapshot.configVersion,
        });
        const context = driver.sendContext(instance.id)!;
        expect(context.configVersion).toBe(snapshot.configVersion);
        expect(
            await driver.send(instance.id, {
                id: randomUUID(),
                expected: context,
                account: "mock/b",
                targetType: "private",
                targetId: "isolated-peer",
                message: "hotplug regression",
            }),
        ).toMatchObject({ messageId: expect.any(String) });
        expect(await driver.verification(instance.id, { action: "list" })).toMatchObject({
            outcome: "succeeded",
            configVersion: snapshot.configVersion,
        });
        expect(
            await driver.exploreAccount(instance.id, {
                expected: context,
                account: "mock/b",
                action: "friends",
                kind: "friend",
            }),
        ).toMatchObject({ action: "friends", expected: context });
        // 已建立的 B socket 在 A 变化后仍处理 API，不能只以 readyState 假定连接可用。
        const reply = once(socket, "message");
        socket.send(
            JSON.stringify({ action: "get_login_info", params: {}, echo: "after-hotplug" }),
        );
        expect(JSON.parse(String((await reply)[0]))).toMatchObject({
            status: "ok",
            echo: "after-hotplug",
        });
        const removed = { ...next };
        delete (removed as Partial<typeof next>)["mock.a"];
        const last = createGatewayConfigurationSnapshot(root, removed);
        expect(
            await driver.applyRuntimeConfiguration({
                id: randomUUID(),
                expected: driver.runtimeContext(instance.id)!,
                nextConfigVersion: last.configVersion,
                configPath: last.configPath,
            }),
        ).toMatchObject({ status: "applied" });
        expect(await login("a", "isolated-test-token")).toBe(404);
        expect(await login("b")).toBe(200);
        expect(socket.readyState).toBe(WebSocket.OPEN);
        expect(instance.pid).toBeGreaterThan(0);
        expect(() => process.kill(instance!.pid!, 0)).not.toThrow();
    } finally {
        socket?.terminate();
        if (instance) await driver.stop(instance);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
