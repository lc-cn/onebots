import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GatewayMcpClient } from "./gateway-mcp-client.js";
import { NodeGatewayDriver } from "./gateway-driver.js";
import type { GatewayMcpMessage } from "../gateway/mcp-contracts.js";
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.useRealTimers();
});
function fixture() {
    const child = Object.assign(new EventEmitter(), {
        connected: true,
        exitCode: null,
        signalCode: null,
        send: vi.fn((_message: GatewayMcpMessage, callback: (error: Error | null) => void) => {
            callback(null);
            return true;
        }),
    });
    const identity = {
        protocolVersion: 1 as const,
        controlInstanceId: randomUUID(),
        gatewayInstanceId: randomUUID(),
    };
    const client = new GatewayMcpClient(child as unknown as ChildProcess, identity);
    cleanups.push(() => client.close());
    return { child, client, identity };
}
const request = () => ({ action: "poll" as const, sessionId: randomUUID() });
it("matches request and both identities with a single shared listener", async () => {
    const f = fixture(),
        pending = f.client.request(request());
    const sent = f.child.send.mock.calls[0][0];
    const reply = {
        type: "gateway.mcp.result",
        ...f.identity,
        requestId: sent.requestId,
        ok: true,
        result: { events: ["exact"] },
    };
    f.child.emit("message", { ...reply, gatewayInstanceId: randomUUID() });
    f.child.emit("message", { ...reply, controlInstanceId: randomUUID() });
    f.child.emit("message", { ...reply, requestId: randomUUID() });
    f.child.emit("message", { ...reply, result: { events: ["x".repeat(65536)] } });
    expect(f.child.listenerCount("message")).toBe(1);
    f.child.emit("message", reply);
    await expect(pending).resolves.toEqual({ events: ["exact"] });
    f.client.close();
    expect(f.child.listenerCount("message")).toBe(0);
});
it("limits pending work, times out as unknown and never replays", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const results = Array.from({ length: 32 }, () =>
        f.client.request(request()).catch(error => error.message),
    );
    await expect(f.client.request(request())).rejects.toThrow("上限");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await Promise.all(results)).toEqual(Array(32).fill("MCP 请求超时，执行结果未知"));
    expect(f.child.send).toHaveBeenCalledTimes(32);
});
it.each(["disconnect", "close", "error"])(
    "%s rejects pending work without leaking errors",
    async event => {
        const f = fixture(),
            pending = f.client.request(request());
        f.child.emit(event, new Error("private-token"));
        await expect(pending).rejects.toThrow("执行结果未知");
        await expect(f.client.request(request())).rejects.toThrow("网关不可用");
        expect(f.child.send).toHaveBeenCalledOnce();
    },
);
it("send errors are fixed and invalid requests never dispatch", async () => {
    const f = fixture();
    f.child.send.mockImplementation((_message, callback) => {
        callback(new Error("private-token"));
        return false;
    });
    await expect(f.client.request(request())).rejects.toThrow("MCP 请求发送失败，执行结果未知");
    await expect(f.client.request({ ...request(), message: "unexpected" })).rejects.toThrow(
        "请求无效",
    );
    expect(f.child.send).toHaveBeenCalledOnce();
});
it("real ready child capability gates requests and stop rejects in-flight exchange", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ob-driver-mcp-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const entry = path.join(root, "gateway.mjs");
    await writeFile(
        entry,
        `
process.on('disconnect',()=>process.exit(0));
process.on('message',value=>{
 if(value.type==='gateway.start') process.send({...value,type:'gateway.ready',capabilities:['mcp'],address:{host:'127.0.0.1',port:12345}});
 if(value.type==='gateway.stop') process.exit(0);
 if(value.type==='gateway.mcp' && value.request.action==='poll') process.send({type:'gateway.mcp.result',protocolVersion:1,controlInstanceId:value.controlInstanceId,gatewayInstanceId:value.gatewayInstanceId,requestId:value.requestId,ok:true,result:{events:['unchanged']}});
});`,
    );
    const driver = new NodeGatewayDriver({
        controlInstanceId: randomUUID(),
        onExit: () => {},
        prepare: async () => ({
            entrypoint: entry,
            runtimeRoot: root,
            workspacePath: root,
            configPath: path.join(root, "config.yaml"),
            selection: { adapters: [], protocols: [], applications: [] },
            configVersion: "1",
            dependencyVersion: "1",
        }),
    });
    await expect(driver.mcp(randomUUID(), request())).rejects.toThrow("不可用");
    const instance = await driver.start();
    cleanups.push(() => driver.stop(instance));
    await expect(driver.mcp(instance.id, request())).resolves.toEqual({ events: ["unchanged"] });
    const pending = driver
        .mcp(instance.id, { action: "exchange", sessionId: randomUUID(), message: "{}" })
        .catch(error => error.message);
    await driver.stop(instance);
    expect(await pending).toContain("执行结果未知");
    await expect(driver.mcp(instance.id, request())).rejects.toThrow("不可用");
});
