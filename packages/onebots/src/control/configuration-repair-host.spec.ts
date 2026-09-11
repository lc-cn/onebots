import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startControlHost } from "./host.js";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
    const root = fs.mkdtempSync("/tmp/ob-repair-http-");
    cleanups.push(async () => {
        fs.rmSync(root, { recursive: true, force: true });
    });
    const original = Buffer.from('password: "不得返回的原始值\r\nbad: [\r\n');
    fs.writeFileSync(path.join(root, "config.yaml"), original);
    const host = await startControlHost({
        workspace: root,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    cleanups.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("监听未建立");
    const url = `http://127.0.0.1:${address.port}`;
    let token = "";
    const client = new ControlClient(createHttpControlTransport(url, () => token));
    ({ token } = await client.pair((await createLocalControlClient(root).bootstrap()).code));
    return { root, original, client, url, host, token };
}
describe("损坏配置的统一管理恢复入口", () => {
    it("重启发现中断记录时仅本地可对账恢复，HTTP无恢复写入权限", async () => {
        const test = await fixture();
        await test.client.gateway("stop");
        const context = await test.client.createConfigurationRepairDraft(
            (await test.client.configurationSource()).base,
        );
        const validation = await test.client.validateConfigurationDraft(
            context.draft.id,
            context.draft.revision,
        );
        expect(
            (await test.client.applyConfiguration("cold-repair", validation.receiptId!)).status,
        ).toBe("succeeded");
        const base = (await test.client.configurationSource()).base;
        await test.host.close();
        // 模拟候选文件已落盘而完成记录尚未持久化；不是把此用例冒充真实断电测试。
        const journalFile = path.join(
            test.root,
            ".control/configuration-applications/cold-repair.json",
        );
        const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
        journal.status = "running";
        journal.phase = "writing";
        delete journal.configRevision;
        fs.writeFileSync(journalFile, JSON.stringify(journal), { mode: 0o600 });
        const restarted = await startControlHost({ workspace: test.root, port: 0 });
        cleanups.push(() => restarted.close());
        const address = restarted.server.address();
        if (!address || typeof address === "string") throw new Error("监听未建立");
        const response = await fetch(
            `http://127.0.0.1:${address.port}/api/control/configuration/reconcile`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${test.token}`,
                },
                body: JSON.stringify({ id: "cold-repair", expectedRevision: base.configRevision }),
            },
        );
        expect(response.status).toBe(403);
        const local = createLocalControlClient(test.root);
        const operation = await local.reconcileConfiguration("cold-repair", base.configRevision);
        expect(operation).toMatchObject({
            status: "failed",
            rolledBack: true,
            sourceState: "damaged",
            recoveryRequired: false,
        });
        expect(fs.readFileSync(path.join(test.root, "config.yaml"))).toEqual(test.original);
        expect((await local.status()).gateway.actual).toBe("stopped");
        await expect(
            local.createConfigurationRepairDraft((await local.configurationSource()).base),
        ).resolves.toHaveProperty("draft");
    });
    it.each(["running", "stopped"] as const)(
        "%s意图下显式修复、恢复草稿、验证及应用，Web全程在线",
        async desired => {
            const test = await fixture();
            if (desired === "stopped") await test.client.gateway("stop");
            await expect(test.client.configurationSnapshot()).rejects.toThrow();
            const source = await test.client.configurationSource();
            expect(source).toMatchObject({
                state: "damaged",
                reason: "INVALID_YAML",
                repairAvailable: true,
            });
            expect(JSON.stringify(source)).not.toContain("不得返回");
            await expect(test.client.createConfigurationDraft(source.base)).rejects.toThrow();
            const context = await test.client.createConfigurationRepairDraft(source.base);
            expect(context.draft.document).toEqual({
                plugins: { adapters: [], protocols: [], applications: [] },
            });
            expect(JSON.stringify(context)).not.toContain("backupId");
            expect(fs.readFileSync(path.join(test.root, "config.yaml"))).toEqual(test.original);
            expect(await test.client.configurationDraftContext(context.draft.id)).toEqual(context);
            const validation = await test.client.validateConfigurationDraft(
                context.draft.id,
                context.draft.revision,
            );
            expect(validation.valid).toBe(true);
            const result = await test.client.applyConfiguration(
                `repair-${desired}`,
                validation.receiptId!,
            );
            expect(result.status).toBe("succeeded");
            expect(await test.client.configurationSource()).toMatchObject({ state: "ready" });
            const status = await test.client.status();
            expect(status.gateway.desired).toBe(desired);
            expect(status.gateway.actual).toBe(desired);
            expect((await fetch(`${test.url}/ready`)).status).toBe(200);
            const backups = path.join(test.root, ".control/configuration/recovery");
            const files = fs.readdirSync(backups);
            expect(files).toHaveLength(1);
            expect(fs.readFileSync(path.join(backups, files[0]))).toEqual(test.original);
        },
    );
    it("修复基线发生外部变化时拒绝创建，不把新文件覆盖为空", async () => {
        const test = await fixture();
        const source = await test.client.configurationSource();
        fs.writeFileSync(path.join(test.root, "config.yaml"), "external: intact\n");
        await expect(test.client.createConfigurationRepairDraft(source.base)).rejects.toMatchObject(
            { status: 409 },
        );
        expect(fs.readFileSync(path.join(test.root, "config.yaml"), "utf8")).toBe(
            "external: intact\n",
        );
    });
});
