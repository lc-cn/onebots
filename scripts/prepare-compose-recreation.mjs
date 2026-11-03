/** 只供隔离 Compose 验收使用：通过公开控制入口安装并配置 Mock/OneBot，无真实账号。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalControlClient } from "/app/packages/onebots/lib/client/local-control.js";

const client = createLocalControlClient("/data");
const catalog = await client.installationCatalog();
assert.equal(catalog.activeGenerationId, null, "只允许使用全新验收数据卷");
const plan = await client.planInstallation(
    {
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        applications: [],
    },
    null,
);
const id = `compose-${randomUUID()}`;
await client.install({ id, planId: plan.id });
const deadline = performance.now() + 10 * 60_000;
let operation;
while (performance.now() < deadline) {
    operation = await client.installation(id);
    if (["verified", "failed", "interrupted"].includes(operation.phase)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(operation?.phase, "verified", "Compose 夹具必须完成真实安装与验证");
assert.equal((await client.activateGeneration(operation.candidateId)).status, "succeeded");
const snapshot = await client.configurationSnapshot();
const draft = await client.createConfigurationDraft(snapshot.base);
const account = await client.addConfigurationAccount(draft.id, {
    expectedRevision: draft.revision,
    platform: "mock",
    accountId: "bot",
});
const protocol = await client.setConfigurationProtocol(draft.id, {
    expectedRevision: account.revision,
    accountKey: "mock.bot",
    protocol: "onebot.v11",
    enabled: true,
});
const edited = await client.editConfigurationDraft(draft.id, {
    expectedRevision: protocol.revision,
    changes: [{ op: "set", path: ["mock.bot", "onebot.v11", "use_http"], value: true }],
    secrets: [],
});
const validation = await client.validateConfigurationDraft(draft.id, edited.revision);
assert.equal(validation.valid, true);
assert.ok(validation.receiptId);
assert.equal(
    (
        await client.applyConfiguration(
            `compose-config-${randomUUID()}`,
            validation.receiptId,
            validation.impact?.mode === "restart" ? { allowRestart: true } : undefined,
        )
    ).status,
    "succeeded",
);
