import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, expect, it } from "vitest";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
    const workspace = fs.mkdtempSync("/tmp/ob-hot-host-");
    cleanups.push(async () => fs.rmSync(workspace, { recursive: true, force: true }));
    const runtimeRoot = path.join(workspace, "runtime");
    fs.mkdirSync(path.join(runtimeRoot, "node_modules/@onebots"), { recursive: true });
    for (const [name, directory] of [
        ["onebots", "packages/onebots"],
        ["@onebots/adapter-mock", "adapters/adapter-mock"],
        ["@onebots/protocol-onebot-v11", "protocols/onebot-v11/protocol"],
    ])
        fs.symlinkSync(
            path.resolve(directory),
            path.join(runtimeRoot, "node_modules", name),
            "dir",
        );
    fs.writeFileSync(
        path.join(workspace, "config.yaml"),
        yaml.dump({
            plugins: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
            "mock.alpha": { "onebot.v11": { use_http: true } },
            "mock.beta": { "onebot.v11": { use_http: true } },
        }),
    );
    const host = await startControlHost({
        workspace,
        runtimeRoot,
        port: 0,
        gatewayEntrypoint: path.resolve("packages/onebots/lib/gateway/entry.js"),
    });
    cleanups.push(() => host.close());
    const client = createLocalControlClient(workspace);
    await expect
        .poll(
            async () =>
                (await client.status()).accounts?.items.filter(item => item.status === "online")
                    .length,
        )
        .toBe(2);
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("测试管理入口不可用");
    return { client, url: `http://127.0.0.1:${address.port}` };
}
it("公开配置API应用单账号协议时网关实例不变，另一个账号协议持续服务", async () => {
    const { client, url } = await fixture();
    const instance = (await client.status()).gateway.instance;
    const snapshot = await client.configurationSnapshot();
    const draft = await client.createConfigurationDraft(snapshot.base);
    const edited = await client.editConfigurationDraft(draft.id, {
        expectedRevision: draft.revision,
        changes: [
            { op: "set", path: ["mock.alpha", "onebot.v11", "heartbeat_interval"], value: 8000 },
        ],
        secrets: [],
    });
    const validation = await client.validateConfigurationDraft(draft.id, edited.revision);
    expect(validation.impact).toMatchObject({
        mode: "hot",
        accounts: [],
        protocols: [{ accountId: "alpha", action: "replace" }],
    });
    const operation = await client.applyConfiguration(
        "change-alpha-protocol",
        validation.receiptId!,
    );
    expect(operation).toMatchObject({ status: "succeeded", executionMode: "hot" });
    expect((await client.status()).gateway.instance).toEqual(instance);
    await expect
        .poll(
            async () =>
                (await client.status()).accounts?.items.find(item => item.accountId === "beta")
                    ?.status,
        )
        .toBe("online");
    const response = await fetch(`${url}/mock/beta/onebot/v11/get_login_info`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(await client.applyConfiguration("change-alpha-protocol", validation.receiptId!)).toEqual(
        operation,
    );
    expect((await client.status()).gateway.instance).toEqual(instance);
});
it("进程配置未明确授权重启时公开API拒绝，旧实例和配置保留", async () => {
    const { client } = await fixture();
    const instance = (await client.status()).gateway.instance;
    const snapshot = await client.configurationSnapshot();
    const draft = await client.createConfigurationDraft(snapshot.base);
    const edited = await client.editConfigurationDraft(draft.id, {
        expectedRevision: draft.revision,
        changes: [{ op: "set", path: ["database"], value: "candidate.db" }],
        secrets: [],
    });
    const validation = await client.validateConfigurationDraft(draft.id, edited.revision);
    expect(validation.impact?.mode).toBe("restart");
    await expect(
        client.applyConfiguration("reject-global-restart", validation.receiptId!),
    ).rejects.toThrow();
    expect((await client.status()).gateway.instance).toEqual(instance);
    expect((await client.configurationSnapshot()).base).toEqual(snapshot.base);
});
