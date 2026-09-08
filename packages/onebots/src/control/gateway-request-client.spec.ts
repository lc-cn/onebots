import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NodeGatewayDriver } from "./gateway-driver.js";
it("one real child supports independent MCP/send codecs and context rejects stale configs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ob-send-driver-")),
        entry = path.join(root, "gateway.mjs");
    await writeFile(
        entry,
        `
process.on('disconnect',()=>process.exit(0));
process.on('message',m=>{
 if(m.type==='gateway.start')process.send({...m,type:'gateway.ready',capabilities:['mcp','send'],address:{host:'127.0.0.1',port:12345}});
 if(m.type==='gateway.stop')process.exit(0);
 if(m.type==='gateway.mcp')process.send({type:'gateway.mcp.result',protocolVersion:1,controlInstanceId:m.controlInstanceId,gatewayInstanceId:m.gatewayInstanceId,requestId:m.requestId,ok:true,result:{events:[]}});
 if(m.type==='gateway.send'){
  const base={type:'gateway.send.result',protocolVersion:1,controlInstanceId:m.controlInstanceId,gatewayInstanceId:m.gatewayInstanceId,requestId:m.requestId,operationId:m.request.id,configVersion:m.request.expected.configVersion,outcome:'succeeded',result:{messageId:'real-result'}};
  process.send({...base,configVersion:'b'.repeat(64),result:{messageId:'wrong'}});
  process.send({...base,operationId:'00000000-0000-4000-8000-000000000000',result:{messageId:'wrong'}});
  process.send(base);
 }
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
            configVersion: "a".repeat(64),
            dependencyVersion: "1",
        }),
    });
    let instance: Awaited<ReturnType<typeof driver.start>> | undefined;
    try {
        instance = await driver.start();
        const expected = driver.sendContext(instance.id)!;
        const request = {
            id: randomUUID(),
            expected,
            account: "mock/id",
            targetType: "private" as const,
            targetId: 123,
            message: "hello",
        };
        await expect(
            driver.send(instance.id, {
                ...request,
                expected: { ...expected, configVersion: "b".repeat(64) },
            }),
        ).rejects.toMatchObject({ outcome: "rejected" });
        await expect(driver.send(instance.id, request)).resolves.toEqual({
            messageId: "real-result",
        });
        await expect(
            driver.mcp(instance.id, { action: "poll", sessionId: randomUUID() }),
        ).resolves.toEqual({ events: [] });
        await driver.stop(instance);
        expect(driver.sendContext(instance.id)).toBeUndefined();
    } finally {
        if (instance && driver.hasLiveChildren()) await driver.stop(instance);
        await rm(root, { recursive: true, force: true });
    }
});
