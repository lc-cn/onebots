import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
let directory: string | undefined;
const originalCode = process.env.ONEBOTS_BOOTSTRAP_CODE;
afterEach(async () => {
    await host?.close();
    host = undefined;
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    if (originalCode === undefined) delete process.env.ONEBOTS_BOOTSTRAP_CODE;
    else process.env.ONEBOTS_BOOTSTRAP_CODE = originalCode;
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
