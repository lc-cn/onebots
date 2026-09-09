import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";
const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("已停止网关仍可通过HTTP和本机读取日志，匿名与撤销设备均拒绝", async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync("/tmp/ob-host-logs-"));
    roots.push(workspace);
    const host = await startControlHost({
        workspace,
        port: 0,
        gatewayEntrypoint: path.resolve("packages/onebots/lib/gateway/entry.js"),
    });
    cleanups.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("缺少地址");
    const url = `http://127.0.0.1:${address.port}`;
    const local = createLocalControlClient(workspace);
    const { code } = await local.bootstrap();
    const anonymous = new ControlClient(createHttpControlTransport(url, () => ""));
    const { token } = await anonymous.pair(code);
    const client = new ControlClient(createHttpControlTransport(url, () => token));
    await client.gateway("stop");
    fs.appendFileSync(path.join(workspace, ".control", "gateway.log"), "test-log-after-stop\n");
    const result = await client.logs.gateway();
    expect(result.text).toContain("test-log-after-stop");
    expect(result).toEqual(await local.logs.gateway());
    await expect(anonymous.logs.gateway()).rejects.toThrow("无法读取网关日志");
    expect((await fetch(url + "/api/control/logs/gateway")).status).toBe(401);
    const invalid = await fetch(url + "/api/control/logs/gateway", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(invalid.status).toBe(405);
    await client.logout();
    await expect(client.logs.gateway()).rejects.toThrow("无法读取网关日志");
    expect(
        (
            await fetch(url + "/api/control/logs/gateway", {
                headers: { Authorization: `Bearer ${token}` },
            })
        ).status,
    ).toBe(401);
    expect((await local.logs.gateway()).text).toContain("test-log-after-stop");
});
