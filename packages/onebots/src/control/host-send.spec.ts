import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
    ControlClient,
    createHttpControlTransport,
    type ControlSendRequest,
} from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";
const exec = promisify(execFile);
const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function directory() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-send-host-"));
    roots.push(root);
    return root;
}
function fixture() {
    const workspace = directory(),
        runtimeRoot = directory();
    fs.writeFileSync(
        path.join(workspace, "config.yaml"),
        "plugins:\n  adapters: [mock]\n  protocols: []\n  applications: []\nmock.bot: {}\n",
        { mode: 0o600 },
    );
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), '{"type":"module"}');
    fs.mkdirSync(path.join(runtimeRoot, "node_modules/@onebots"), { recursive: true });
    for (const [name, target] of [
        ["onebots", "packages/onebots"],
        ["@onebots/core", "packages/core"],
        ["@onebots/adapter-mock", "adapters/adapter-mock"],
    ])
        fs.symlinkSync(path.resolve(target), path.join(runtimeRoot, "node_modules", name), "dir");
    return { workspace, runtimeRoot };
}
async function start(f: ReturnType<typeof fixture>) {
    const host = await startControlHost({
        ...f,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    let closed = false;
    const close = async () => {
        if (!closed) {
            closed = true;
            await host.close();
        }
    };
    cleanups.push(close);
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("no listener");
    const local = createLocalControlClient(f.workspace),
        url = `http://127.0.0.1:${address.port}`;
    const anonymous = new ControlClient(createHttpControlTransport(url, () => ""));
    return { host, close, local, anonymous, url };
}
async function pair(running: Awaited<ReturnType<typeof start>>) {
    const { token } = await running.anonymous.pair((await running.local.bootstrap()).code);
    return new ControlClient(createHttpControlTransport(running.url, () => token));
}
async function request(client: ControlClient): Promise<ControlSendRequest> {
    return {
        id: randomUUID(),
        expected: await client.sendContext(),
        account: "mock/bot",
        targetType: "private",
        targetId: "00123",
        message: "mock-local-only",
    };
}
describe("管理服务发送真实集成", () => {
    it("无协议发送成功、同ID回执持久复用、同ID不同正文拒绝、重启不重放", async () => {
        const f = fixture(),
            running = await start(f),
            web = await pair(running);
        await expect(running.anonymous.sendContext()).rejects.toThrow();
        const input = await request(running.local);
        await expect(running.anonymous.sendMessage(input)).rejects.toThrow();
        const receipt = await running.local.sendMessage(input);
        expect(receipt.status).toBe("succeeded");
        expect(typeof receipt.messageId).toBe("string");
        expect(await running.local.sendMessage(input)).toEqual(receipt);
        await expect(
            running.local.sendMessage({ ...input, message: "different" }),
        ).rejects.toThrow();
        await expect(web.sendOperation(input.id)).rejects.toThrow();
        await expect(web.sendMessage(input)).rejects.toThrow();
        expect((await running.local.gateway("stop")).status).toBe("succeeded");
        expect((await web.status()).gateway.actual).toBe("stopped");
        expect(await running.local.sendOperation(input.id)).toEqual(receipt);
        expect((await running.local.gateway("restart")).status).toBe("succeeded");
        expect((await running.local.sendContext()).gatewayInstanceId).not.toBe(
            input.expected.gatewayInstanceId,
        );
        expect(await running.local.sendMessage(input)).toEqual(receipt);
        await running.close();
        const reopened = await start(f);
        expect(await reopened.local.sendOperation(input.id)).toEqual(receipt);
        expect(await reopened.local.sendMessage(input)).toEqual(receipt);
        expect((await reopened.local.status()).gateway.actual).toBe("running");
    });
    it("真实CLI JSON发送后查询原ID，实例保持不变且无旧登录", async () => {
        const f = fixture(),
            running = await start(f),
            before = await running.local.status(),
            id = randomUUID();
        const bin = path.resolve(import.meta.dirname, "../../lib/bin.js");
        const options = {
            timeout: 15_000,
            maxBuffer: 128 * 1024,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
        };
        const sent = await exec(
            process.execPath,
            [
                bin,
                "send",
                "--data-dir",
                f.workspace,
                "--account",
                "mock/bot",
                "--target-type",
                "private",
                "--operation-id",
                id,
                "--json",
                "00123",
                "synthetic-secret-body",
            ],
            options,
        );
        const summary = JSON.parse(sent.stdout);
        expect(summary).toMatchObject({ operationId: id, status: "succeeded" });
        expect(sent.stdout.trim().split("\n")).toHaveLength(1);
        expect(sent.stdout + sent.stderr).not.toContain("synthetic-secret-body");
        const queried = await exec(
            process.execPath,
            [bin, "send", "--data-dir", f.workspace, "--operation-id", id, "--json"],
            options,
        );
        expect(JSON.parse(queried.stdout)).toEqual(summary);
        const after = await running.local.status();
        expect(after.manager.id).toBe(before.manager.id);
        expect(after.gateway.instance).toEqual(before.gateway.instance);
        // 未配对的管理端仍可签发首次码，CLI未偷偷创建旧HTTP登录会话。
        expect((await running.local.bootstrap()).code).toBeTruthy();
        const config = fs.readFileSync(path.join(f.workspace, "config.yaml"), "utf8");
        expect(config).toContain("protocols: []");
    });
});
