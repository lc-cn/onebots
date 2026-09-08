import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

const roots: string[] = [];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function directory() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-mcp-host-"));
    roots.push(root);
    return root;
}
async function fixture() {
    const workspace = directory(),
        runtimeRoot = directory();
    fs.writeFileSync(
        path.join(workspace, "config.yaml"),
        [
            "plugins:",
            "  adapters: [mock]",
            "  protocols: [mcp-v1]",
            "  applications: []",
            "mock.bot:",
            "  mcp.v1: {}",
            "",
        ].join("\n"),
        { mode: 0o600 },
    );
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), '{"type":"module"}');
    fs.mkdirSync(path.join(runtimeRoot, "node_modules/@onebots"), { recursive: true });
    for (const [name, target] of [
        ["onebots", "packages/onebots"],
        ["@onebots/core", "packages/core"],
        ["@onebots/adapter-mock", "adapters/adapter-mock"],
        ["@onebots/protocol-mcp-v1", "protocols/mcp-v1/protocol"],
    ])
        fs.symlinkSync(path.resolve(target), path.join(runtimeRoot, "node_modules", name), "dir");
    const host = await startControlHost({
        workspace,
        runtimeRoot,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    cleanup.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing TCP listener");
    const local = createLocalControlClient(workspace);
    const url = `http://127.0.0.1:${address.port}`;
    const anonymous = new ControlClient(createHttpControlTransport(url, () => ""));
    const { code } = await local.bootstrap();
    const { token } = await anonymous.pair(code);
    const web = new ControlClient(createHttpControlTransport(url, () => token));
    return { host, local, web, anonymous, workspace };
}
async function request(client: ControlClient, id: string, method: string, requestId: number) {
    const response = await client.exchangeMcp(
        id,
        JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method,
            ...(method === "initialize"
                ? {
                      params: {
                          protocolVersion: "2025-03-26",
                          capabilities: {},
                          clientInfo: { name: "test", version: "1" },
                      },
                  }
                : {}),
        }),
    );
    expect(response.message).not.toBeNull();
    const parsed = JSON.parse(response.message!);
    expect(parsed).toMatchObject({ jsonrpc: "2.0", id: requestId });
    expect(parsed).not.toHaveProperty("error");
    return parsed;
}
describe("真实管理服务 MCP 会话", () => {
    it("匿名拒绝，本地会话初始化和工具列表可用，Web会话不能借用本地会话", async () => {
        const f = await fixture();
        await expect(f.anonymous.openMcp("mock/bot")).rejects.toThrow();
        const session = await f.local.openMcp("mock/bot");
        expect(session.gatewayInstanceId).toBeTruthy();
        expect((await request(f.local, session.id, "initialize", 1)).result.serverInfo.name).toBe(
            "onebots-mcp",
        );
        expect(
            await f.local.exchangeMcp(
                session.id,
                '{"jsonrpc":"2.0","method":"notifications/initialized"}',
            ),
        ).toEqual({ message: null });
        expect(
            (await request(f.local, session.id, "tools/list", 2)).result.tools.length,
        ).toBeGreaterThan(0);
        expect((await request(f.local, session.id, "ping", 3)).result).toEqual({});
        expect(await f.local.pollMcp(session.id)).toEqual({ events: [] });
        await expect(
            f.web.exchangeMcp(session.id, '{"jsonrpc":"2.0","id":4,"method":"ping"}'),
        ).rejects.toThrow();
        await expect(f.web.pollMcp(session.id)).rejects.toThrow();
        await expect(f.web.closeMcp(session.id)).rejects.toThrow();
        const webSession = await f.web.openMcp("mock/bot");
        await request(f.web, webSession.id, "initialize", 1);
        await request(f.web, webSession.id, "ping", 2);
        await expect(
            f.local.exchangeMcp(webSession.id, '{"jsonrpc":"2.0","id":4,"method":"ping"}'),
        ).rejects.toThrow();
        expect(await f.web.closeMcp(webSession.id)).toEqual({ closed: true });
        expect(await f.local.closeMcp(session.id)).toEqual({ closed: true });
    });
    it("真实 CLI stdio 初始化后 EOF 不创建新网关，管理仍在线", async () => {
        const f = await fixture();
        const before = await f.local.status();
        const child = spawn(
            process.execPath,
            [
                path.resolve(import.meta.dirname, "../../lib/bin.js"),
                "mcp",
                "--data-dir",
                f.workspace,
                "--account",
                "mock/bot",
            ],
            {
                stdio: ["pipe", "pipe", "pipe"],
                env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
            },
        );
        const completion = new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
        });
        cleanup.push(async () => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            await completion;
        });
        let output = "",
            initialized = false;
        const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
        child.stderr.resume();
        child.stdout.on("data", chunk => {
            output += chunk.toString();
            if (!initialized && output.includes("\n")) {
                initialized = true;
                child.stdin.end(
                    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
                );
            }
        });
        child.stdin.write(
            '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n',
        );
        try {
            expect(await completion).toBe(0);
        } finally {
            clearTimeout(timer);
        }
        const messages = output
            .trim()
            .split("\n")
            .map(line => JSON.parse(line));
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
            id: 1,
            result: { serverInfo: { name: "onebots-mcp" } },
        });
        expect(messages[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
        const after = await f.web.status();
        expect(after.manager.id).toBe(before.manager.id);
        expect(after.gateway.actual).toBe("running");
        expect(after.gateway.instance).toEqual(before.gateway.instance);
    });
    it("停止网关保留管理端，重启后旧会话不重绑定或重放", async () => {
        const f = await fixture(),
            old = await f.local.openMcp("mock/bot");
        await request(f.local, old.id, "initialize", 1);
        expect((await f.local.gateway("stop")).status).toBe("succeeded");
        expect((await f.web.status()).gateway.actual).toBe("stopped");
        const message = '{"jsonrpc":"2.0","id":7,"method":"ping"}';
        await expect(f.local.exchangeMcp(old.id, message)).rejects.toThrow();
        expect((await f.local.gateway("restart")).status).toBe("succeeded");
        const next = await f.local.openMcp("mock/bot");
        expect(next.id).not.toBe(old.id);
        expect(next.gatewayInstanceId).not.toBe(old.gatewayInstanceId);
        await expect(f.local.exchangeMcp(old.id, message)).rejects.toThrow();
        await request(f.local, next.id, "initialize", 1);
        expect((await request(f.local, next.id, "ping", 7)).result).toEqual({});
        expect((await f.web.status()).gateway.actual).toBe("running");
        await f.local.closeMcp(next.id);
    });
});
