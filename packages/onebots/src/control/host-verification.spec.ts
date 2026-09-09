import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-verification-host-"));
    roots.push(root);
    return root;
}
async function fixture(secret: string) {
    const workspace = directory();
    const runtimeRoot = directory();
    const calls = path.join(runtimeRoot, "verification-calls");
    const core = JSON.stringify(pathToFileURL(path.resolve("packages/core/lib/index.js")).href);
    function extension(name: string, source: string) {
        const root = path.join(runtimeRoot, "node_modules", "@onebots", name);
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({
                name: `@onebots/${name}`,
                version: "0.0.0",
                type: "module",
                main: "index.js",
            }),
        );
        fs.writeFileSync(path.join(root, "index.js"), source);
    }
    extension(
        "adapter-confirm",
        `
        import { Account, Adapter, AdapterRegistry } from ${core};
        import { appendFileSync } from "node:fs";
        class ConfirmAdapter extends Adapter {
            constructor(app) { super(app, "confirm"); }
            submitVerification(id, type, data) {
                if (type !== "pair_code" || data.code !== ${JSON.stringify(secret)}) throw new Error("测试验证码错误");
                appendFileSync(${JSON.stringify(calls)}, ${JSON.stringify("submit\n")});
                this.finish();
            }
            createAccount(config) {
                const account = new Account(this, {}, config);
                account.on("start", signal => new Promise((resolve, reject) => {
                    const abort = () => reject(new DOMException("已取消", "AbortError"));
                    if (signal.aborted) { abort(); return; }
                    signal.addEventListener("abort", abort, { once: true });
                    this.finish = () => {
                        signal.removeEventListener("abort", abort);
                        account.status = "online";
                        resolve();
                    };
                    this.emit("verification:request", {
                        platform: "confirm", account_id: config.account_id, type: "pair_code", hint: "请输入验证码",
                        options: { blocks: [{ type: "input", key: "code", secret: true, maxLength: 64 }] }
                    });
                }));
                return account;
            }
        }
        AdapterRegistry.register("confirm", ConfirmAdapter);
        AdapterRegistry.registerSchema("confirm", {});
    `,
    );
    extension(
        "protocol-confirm-v1",
        `
        import { Protocol, ProtocolRegistry } from ${core};
        class ConfirmProtocol extends Protocol {
            name = "confirm"; version = "v1";
            constructor(adapter, account, config) { super(adapter, account, { ...config, protocol: "confirm", version: "v1" }); }
            start() { this.router.get(this.path + "/status", ctx => { ctx.body = { lifecycleStatus: this.lifecycleStatus }; }); }
            stop() {} dispatch() {} format(event, payload) { return payload; } async apply() { return {}; }
        }
        ProtocolRegistry.register("confirm", "v1", ConfirmProtocol);
        ProtocolRegistry.registerSchema("confirm.v1", {});
    `,
    );
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), '{"type":"module"}');
    fs.writeFileSync(
        path.join(workspace, "config.yaml"),
        "plugins:\n  adapters: [confirm]\n  protocols: [confirm-v1]\n  applications: []\nconfirm.bot:\n  confirm.v1: {}\n",
        { mode: 0o600 },
    );
    const host = await startControlHost({
        workspace,
        runtimeRoot,
        port: 0,
        gatewayEntrypoint: path.resolve("packages/onebots/lib/gateway/entry.js"),
    });
    cleanup.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("缺少管理监听地址");
    const url = `http://127.0.0.1:${address.port}`;
    const local = createLocalControlClient(workspace);
    const anonymous = new ControlClient(createHttpControlTransport(url, () => ""));
    async function pair(initial = false) {
        const { code } = await (initial ? local.bootstrap() : local.authorizeDevice());
        return (await anonymous.pair(code)).token;
    }
    const token = await pair(true);
    const otherToken = await pair();
    function request(route: string, currentToken: string | undefined = token, body?: unknown) {
        return fetch(url + "/api/control/verification/" + route, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
                "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }
    return { host, workspace, calls, token, otherToken, request, url };
}

describe("真实管理服务持久账号验证", () => {
    it("Web 配对完成等待中的账号验证，按 owner 隔离回执且不泄露或重放答案", async () => {
        const secret = "verification-secret-" + randomUUID();
        const f = await fixture(secret);
        expect((await f.request("pending", "")).status).toBe(401);
        const web = new ControlClient(createHttpControlTransport(f.url, () => f.token));
        const pending = await web.verification.pending();
        expect(pending.challenges).toHaveLength(1);
        expect(pending.challenges[0].request).toMatchObject({
            platform: "confirm",
            account_id: "bot",
            type: "pair_code",
        });
        expect((await fetch(f.url + "/confirm/bot/confirm/v1/status")).status).toBe(404);
        const command = {
            operationId: randomUUID(),
            challengeId: pending.challenges[0].id,
            expected: {
                gatewayInstanceId: pending.gatewayInstanceId,
                configVersion: pending.configVersion,
            },
            action: "submit" as const,
            data: { code: secret },
        };
        expect((await f.request("execute", "", command)).status).toBe(401);
        expect(fs.existsSync(f.calls)).toBe(false);
        const receipt = await web.verification.execute(command);
        expect(receipt).toMatchObject({
            id: command.operationId,
            status: "succeeded",
            challengeId: command.challengeId,
            ...command.expected,
        });
        expect(JSON.stringify(receipt)).not.toContain(secret);
        const repeated = await f.request("execute", f.token, command);
        expect(repeated.status).toBe(200);
        expect(await repeated.json()).toEqual(receipt);
        expect(fs.readFileSync(f.calls, "utf8")).toBe("submit\n");
        await expect
            .poll(
                async () => {
                    const response = await fetch(f.url + "/confirm/bot/confirm/v1/status");
                    return response.status === 200 ? response.json() : null;
                },
                { timeout: 5000 },
            )
            .toEqual({ lifecycleStatus: "ready" });
        expect((await (await f.request("pending")).json()).challenges).toEqual([]);
        const route = `operations/${command.operationId}`;
        expect((await f.request(route, "")).status).toBe(401);
        expect((await f.request(route, f.otherToken)).status).toBe(404);
        expect((await f.request("execute", f.otherToken, command)).status).toBe(404);
        expect(await (await f.request(route)).json()).toEqual(receipt);
        expect(
            await createLocalControlClient(f.workspace).verification.operation(command.operationId),
        ).toEqual(receipt);
        const cli = await promisify(execFile)(
            process.execPath,
            [
                path.resolve("packages/onebots/lib/bin.js"),
                "control",
                "verification",
                "operation",
                "--request",
                command.operationId,
                "--data-dir",
                f.workspace,
            ],
            { timeout: 10000 },
        );
        expect(JSON.parse(cli.stdout)).toEqual(receipt);
        expect(fs.readFileSync(f.calls, "utf8")).toBe("submit\n");
        const records = path.join(f.workspace, ".control", "verification", "operations");
        const names = fs.readdirSync(records);
        expect(names).toEqual([`${command.operationId}.json`]);
        for (const name of names) {
            const text = fs.readFileSync(path.join(records, name), "utf8");
            expect(text).not.toContain(secret);
            expect(text).not.toContain(f.token);
            expect(text).not.toContain('"data"');
            expect(text).not.toContain('"code"');
        }
    });
});
