import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each(["stopped", "running"] as const)(
    "真实 HTTP 修复保留 %s 意图，并遵守显式重启许可和幂等回执",
    async desired => {
        const root = fs.mkdtempSync("/tmp/ob-repair-http-");
        cleanups.push(async () => fs.rmSync(root, { recursive: true, force: true }));
        const host = await startControlHost({
            workspace: root,
            port: 0,
            gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
        });
        cleanups.push(() => host.close());
        const address = host.server.address();
        if (!address || typeof address === "string") throw new Error("控制宿主未监听 TCP");
        let token = "";
        const web = new ControlClient(
            createHttpControlTransport(`http://127.0.0.1:${address.port}`, () => token),
        );
        token = (await web.pair((await createLocalControlClient(root).bootstrap()).code)).token;
        await web.gateway("stop");
        const original = Buffer.from('secret: "隔离修复测试\r\nbroken: [\r\n');
        fs.writeFileSync(path.join(root, "config.yaml"), original);
        if (desired === "running")
            expect(await web.gateway("start")).toMatchObject({ status: "failed" });
        const source = await web.configurationSource();
        const context = await web.createConfigurationRepairDraft(source.base);
        const validation = await web.validateConfigurationDraft(
            context.draft.id,
            context.draft.revision,
        );
        expect(validation.valid).toBe(true);
        const id = `repair-${desired}`;
        if (desired === "running") {
            await expect(web.applyConfiguration(id, validation.receiptId)).rejects.toMatchObject({
                status: 400,
            });
            expect(fs.readFileSync(path.join(root, "config.yaml"))).toEqual(original);
        }
        const options = validation.impact?.mode === "restart" ? { allowRestart: true } : undefined;
        const result = await web.applyConfiguration(id, validation.receiptId, options);
        expect(result.status).toBe("succeeded");
        expect(await web.applyConfiguration(id, validation.receiptId)).toEqual(result);
        expect((await web.status()).gateway).toMatchObject({ actual: desired, desired });
        expect((await web.configurationSource()).state).toBe("ready");
    },
);
