import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
let directory: string | undefined;
const originalCode = process.env.ONEBOTS_BOOTSTRAP_CODE;
const originalRecovery = process.env.ONEBOTS_RECOVERY_CODE;
afterEach(async () => {
    await host?.close();
    host = undefined;
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    if (originalCode === undefined) delete process.env.ONEBOTS_BOOTSTRAP_CODE;
    else process.env.ONEBOTS_BOOTSTRAP_CODE = originalCode;
    if (originalRecovery === undefined) delete process.env.ONEBOTS_RECOVERY_CODE;
    else process.env.ONEBOTS_RECOVERY_CODE = originalRecovery;
});

it("部署码在网关启动前消费，HTTP配对一次后重启不能替换已有会话", async () => {
    directory = fs.realpathSync(fs.mkdtempSync("/tmp/ob-deploy-auth-"));
    const code = randomBytes(32).toString("base64url");
    process.env.ONEBOTS_BOOTSTRAP_CODE = code;
    host = await startControlHost({ workspace: directory, port: 0 });
    expect(process.env.ONEBOTS_BOOTSTRAP_CODE).toBeUndefined();
    const client = () => {
        const address = host!.server.address();
        if (!address || typeof address === "string") throw new Error("缺少管理端口");
        return new ControlClient(
            createHttpControlTransport(`http://127.0.0.1:${address.port}`, () => ""),
        );
    };
    const paired = await client().pair(code);
    await expect(client().pair(code)).rejects.toThrow();
    const raw = fs.readFileSync(`${directory}/.control/auth.json`, "utf8");
    expect(raw).not.toContain(code);
    expect(raw).not.toContain(paired.token);
    await createLocalControlClient(directory).gateway("stop");
    await host.close();
    host = undefined;
    process.env.ONEBOTS_BOOTSTRAP_CODE = randomBytes(32).toString("base64url");
    host = await startControlHost({ workspace: directory, port: 0 });
    expect(process.env.ONEBOTS_BOOTSTRAP_CODE).toBeUndefined();
    expect(fs.readFileSync(`${directory}/.control/auth.json`, "utf8")).toBe(raw);
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("缺少管理端口");
    const authorized = new ControlClient(
        createHttpControlTransport(`http://127.0.0.1:${address.port}`, () => paired.token),
    );
    await expect(authorized.status()).resolves.toHaveProperty("manager");
});

it("无终端部署通过新Secret恢复，成功兑换才撤销旧会话且重启不重放", async () => {
    directory = fs.realpathSync(fs.mkdtempSync("/tmp/ob-deploy-recovery-"));
    process.env.ONEBOTS_BOOTSTRAP_CODE = randomBytes(32).toString("base64url");
    const initialCode = process.env.ONEBOTS_BOOTSTRAP_CODE;
    host = await startControlHost({ workspace: directory, port: 0 });
    const client = (token = "") => {
        const address = host!.server.address();
        if (!address || typeof address === "string") throw new Error("缺少管理端口");
        return new ControlClient(
            createHttpControlTransport(`http://127.0.0.1:${address.port}`, () => token),
        );
    };
    const original = await client().pair(initialCode);
    await createLocalControlClient(directory).gateway("stop");
    await host.close();
    host = undefined;
    const recovery = randomBytes(32).toString("base64url");
    process.env.ONEBOTS_RECOVERY_CODE = recovery;
    host = await startControlHost({ workspace: directory, port: 0 });
    expect(process.env.ONEBOTS_RECOVERY_CODE).toBeUndefined();
    await expect(client(original.token).status()).resolves.toHaveProperty("manager");
    const next = await client().pair(recovery);
    await expect(client(original.token).status()).rejects.toThrow();
    await expect(client(next.token).status()).resolves.toHaveProperty("manager");
    const raw = fs.readFileSync(`${directory}/.control/auth.json`, "utf8");
    expect(raw).not.toContain(recovery);
    expect(raw).not.toContain(next.token);
    await host.close();
    host = undefined;
    process.env.ONEBOTS_RECOVERY_CODE = recovery;
    host = await startControlHost({ workspace: directory, port: 0 });
    expect(fs.readFileSync(`${directory}/.control/auth.json`, "utf8")).toBe(raw);
    await expect(client().pair(recovery)).rejects.toThrow();
    await expect(client(next.token).status()).resolves.toHaveProperty("manager");
});
