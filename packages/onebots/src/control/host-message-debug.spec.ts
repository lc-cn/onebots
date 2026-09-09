import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

it("实际管理HTTP和本地客户端共用调试，设备撤销关闭流，停止网关保留管理", async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync("/tmp/ob-debug-host-"));
    const host = await startControlHost({
        workspace,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    const cancel = new AbortController();
    try {
        const address = host.server.address();
        if (!address || typeof address === "string") throw new Error("no TCP listener");
        const url = `http://127.0.0.1:${address.port}`;
        const local = createLocalControlClient(workspace);
        const anonymous = new ControlClient(createHttpControlTransport(url, () => ""));
        await expect(anonymous.messageDebugHistory()).rejects.toThrow();
        const { token } = await anonymous.pair((await local.bootstrap()).code);
        const web = new ControlClient(createHttpControlTransport(url, () => token));
        const snapshot = await web.messageDebugHistory();
        expect(snapshot.entries).toEqual([]);
        expect(await local.messageDebugHistory()).toEqual(snapshot);
        expect(await web.clearMessageDebug(snapshot.gatewayInstanceId)).toEqual({
            gatewayInstanceId: snapshot.gatewayInstanceId,
            clearedCount: 0,
            clearedThroughSeq: 0,
        });
        const stream = await fetch(`${url}/api/control/message-debug/stream`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: cancel.signal,
        });
        expect(stream.status).toBe(200);
        const reader = stream.body!.getReader();
        const first = new TextDecoder().decode((await reader.read()).value);
        expect(first).toContain("event: snapshot");
        expect(first).toContain(snapshot.gatewayInstanceId);
        await web.logout();
        // destroy 可以表现为 EOF 或 socket 错误；二者都不能再交付消息。
        const next = await reader.read().then(
            value => value.done,
            () => true,
        );
        expect(next).toBe(true);
        await expect(web.messageDebugHistory()).rejects.toThrow();
        await local.gateway("stop");
        expect((await local.status()).gateway.actual).toBe("stopped");
        await expect(local.messageDebugHistory()).rejects.toThrow();
        await local.gateway("start");
        const restarted = await local.messageDebugHistory();
        expect(restarted.gatewayInstanceId).not.toBe(snapshot.gatewayInstanceId);
        await expect(local.clearMessageDebug(snapshot.gatewayInstanceId)).rejects.toThrow();
        expect(
            (
                await fetch(`${url}/api/message-debug/history`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
            ).status,
        ).toBe(401);
    } finally {
        cancel.abort();
        await host.close();
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
