import { afterEach, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { isGatewayParentMessage, type GatewayStartMessage } from "./contracts.js";

const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

function spawnGateway(withMock = false) {
    const workspace = mkdtempSync(path.join(tmpdir(), "onebots-gateway-"));
    directories.push(workspace);
    const configPath = path.join(workspace, "snapshot.yaml");
    const source = "port: 6727\ngeneral: {}\n" + (withMock ? "mock.bot:\n  onebot.v11: {}\n" : "");
    writeFileSync(configPath, source);
    if (withMock) {
        const modules = path.join(workspace, "node_modules", "@onebots");
        mkdirSync(modules, { recursive: true });
        symlinkSync(
            path.resolve("adapters/adapter-mock"),
            path.join(modules, "adapter-mock"),
            "dir",
        );
        symlinkSync(
            path.resolve("protocols/onebot-v11/protocol"),
            path.join(modules, "protocol-onebot-v11"),
            "dir",
        );
    }
    const child = fork(path.resolve("packages/onebots/lib/gateway/entry.js"), [], {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...process.env, PORT: "7860", ONEBOTS_ACCESS_TOKEN: "must-not-persist" },
    });
    children.push(child);
    const message: GatewayStartMessage = {
        type: "gateway.start",
        protocolVersion: 1,
        controlInstanceId: "control-test",
        gatewayInstanceId: "gateway-test",
        configVersion: "config-1",
        dependencyVersion: "dependencies-1",
        configPath,
        workspacePath: workspace,
        selection: {
            adapters: withMock ? ["mock"] : [],
            protocols: withMock ? ["onebot-v11"] : [],
            applications: [],
        },
    };
    return { child, message, configPath, source };
}

describe("独立网关 IPC", () => {
    it("真实 Mock 与 OneBot 插件保持单例注册和协议 API", async () => {
        const { child, message } = spawnGateway(true);
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready.type).toBe("gateway.ready");
        const response = await fetch(
            `http://127.0.0.1:${ready.address.port}/mock/bot/onebot/v11/get_login_info`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ status: "ok", retcode: 0 });
        const exited = once(child, "exit");
        child.disconnect();
        expect((await exited)[0]).toBe(0);
    });
    it("拒绝错误身份与无限停机截止时间", () => {
        expect(
            isGatewayParentMessage({
                type: "gateway.stop",
                protocolVersion: 1,
                controlInstanceId: "c",
                gatewayInstanceId: "g",
                timeoutMs: Infinity,
            }),
        ).toBe(false);
        expect(isGatewayParentMessage({ type: "gateway.start" })).toBe(false);
    });

    it("真实进程只监听 loopback、不提供管理端且不生成配置凭据", async () => {
        const { child, message, configPath, source } = spawnGateway();
        const readyPromise = once(child, "message");
        child.send(message);
        const [ready] = await readyPromise;
        expect(ready).toMatchObject({
            type: "gateway.ready",
            gatewayInstanceId: "gateway-test",
            controlInstanceId: "control-test",
            configVersion: "config-1",
            dependencyVersion: "dependencies-1",
            address: { host: "127.0.0.1" },
        });
        expect(ready.address.port).not.toBe(7860);
        for (const route of ["/", "/api/auth/login", "/api/config", "/api/extensions"]) {
            const response = await fetch(`http://127.0.0.1:${ready.address.port}${route}`);
            expect(response.status).toBe(404);
        }
        expect(readFileSync(configPath, "utf8")).toBe(source);
        const exited = once(child, "exit");
        child.send({
            type: "gateway.stop",
            protocolVersion: 1,
            controlInstanceId: "control-test",
            gatewayInstanceId: "gateway-test",
            timeoutMs: 1000,
        });
        expect((await exited)[0]).toBe(0);
    });

    it("父 IPC 断连时退出，不能留下孤儿网关", async () => {
        const { child, message } = spawnGateway();
        const ready = once(child, "message");
        child.send(message);
        await ready;
        const exited = once(child, "exit");
        child.disconnect();
        expect((await exited)[0]).toBe(0);
    });
});
