/** 在全新 CI 容器内执行：docker exec -i <container> node --input-type=module < 此文件。
 * 仅使用公开测试扩展与 Mock 账号；宿主工件由镜像配置，禁止用于生产数据卷。
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createLocalControlClient } from '/app/packages/onebots/lib/client/local-control.js';

const workspace = '/data';
const base = 'http://127.0.0.1:6727';
const client = createLocalControlClient(workspace);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function publicStatus(route, expected) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, expected, route);
    await response.body?.cancel();
}
async function waitReady() {
    for (let attempt = 0; attempt < 60; attempt++) {
        try { await publicStatus('/ready', 200); return; }
        catch (error) { if (attempt === 59) throw error; await pause(1000); }
    }
}
await waitReady();
const catalog = await client.installationCatalog();
assert.equal(catalog.activeGenerationId, null, '此烟测只允许使用全新 CI 数据卷');
const configPath = `${workspace}/config.yaml`;
const initialConfig = await readFile(configPath, 'utf8');
await publicStatus('/', 200);
const plan = await client.planInstallation({
    adapters: ['mock'], protocols: ['onebot-v11', 'mcp-v1'], applications: [],
}, catalog.activeGenerationId);
const id = `ci-${randomUUID()}`;
await client.install({ id, planId: plan.id });
let operation;
let previousPhase;
const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
    operation = await client.installation(id);
    if (operation.phase !== previousPhase) {
        console.log(`[onebots] 安装阶段：${operation.phase}`);
        previousPhase = operation.phase;
    }
    if (['verified', 'failed', 'interrupted'].includes(operation.phase)) break;
    await publicStatus('/', 200);
    await pause(500);
}
assert.equal(operation?.phase, 'verified', '公开扩展候选须经真实下载及独立验证');
assert.equal(operation.planDigest, plan.planDigest);
assert.ok(operation.candidateId);
const directory = `${workspace}/.control/generations/${operation.candidateId}`;
const receipt = JSON.parse(await readFile(`${directory}/receipt.json`, 'utf8'));
assert.equal(receipt.planDigest, plan.planDigest);
assert.ok(Object.values(receipt.checks).every(value => value === true));
const schemas = JSON.parse(await readFile(`${directory}/schemas.json`, 'utf8'));
assert.ok(Object.hasOwn(schemas.adapters, 'mock'));
assert.ok(Object.hasOwn(schemas.protocols, 'mcp-v1'));
assert.ok(Object.hasOwn(schemas.protocols, 'onebot-v11'));
assert.deepEqual(await readdir(`${workspace}/.control/downloads`), []);
const beforeActivation = await client.status();
assert.equal((await client.activateGeneration(operation.candidateId)).status, 'succeeded');
assert.equal((await client.status()).gateway.desired, beforeActivation.gateway.desired,
    '激活必须保留此前网关启停意图');
assert.equal(await readFile(configPath, 'utf8'), initialConfig, '安装不能自动启用账号或协议');
// 前置容器恢复测试会留下 stopped；显式启动后再检查空配置与激活幂等性。
assert.equal((await client.gateway('start')).status, 'succeeded');
const before = await client.status();
assert.equal(before.gateway.desired, 'running');
assert.equal(before.gateway.actual, 'running');
assert.ok(before.gateway.instance?.id);
await publicStatus('/mock/bot/onebot/v11/get_login_info', 404);
assert.equal((await client.activateGeneration(operation.candidateId)).status, 'succeeded');
assert.equal((await client.status()).gateway.instance.id, before.gateway.instance.id);
const snapshot = await client.configurationSnapshot();
const draft = await client.createConfigurationDraft(snapshot.base);
const account = await client.addConfigurationAccount(draft.id, {
    expectedRevision: draft.revision, platform: 'mock', accountId: 'bot',
});
const protocol = await client.setConfigurationProtocol(draft.id, {
    expectedRevision: account.revision, accountKey: 'mock.bot', protocol: 'onebot.v11', enabled: true,
});
const mcp = await client.setConfigurationProtocol(draft.id, {
    expectedRevision: protocol.revision, accountKey: 'mock.bot', protocol: 'mcp.v1', enabled: true,
});
const edited = await client.editConfigurationDraft(draft.id, {
    expectedRevision: mcp.revision,
    changes: [{ op: 'set', path: ['mock.bot', 'onebot.v11', 'use_http'], value: true }], secrets: [],
});
const validation = await client.validateConfigurationDraft(draft.id, edited.revision);
assert.equal(validation.valid, true);
assert.ok(validation.receiptId);
const applyId = `ci-config-${randomUUID()}`;
let mcpSession;
let sendReceipt;
try {
    assert.equal((await client.applyConfiguration(applyId, validation.receiptId)).status, 'succeeded');
    assert.equal((await client.applyConfiguration(applyId, validation.receiptId)).status, 'succeeded');
    const response = await fetch(`${base}/mock/bot/onebot/v11/get_login_info`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
    const messageRequest = {
        id: randomUUID(), expected: await client.sendContext(), account: 'mock/bot',
        targetType: 'private', targetId: '00123', message: 'docker-ci-mock-only',
    };
    sendReceipt = await client.sendMessage(messageRequest);
    assert.equal(sendReceipt.status, 'succeeded');
    assert.equal(typeof sendReceipt.messageId, 'string');
    assert.deepEqual(await client.sendMessage(messageRequest), sendReceipt);

    mcpSession = await client.openMcp('mock/bot');
    const initialized = await client.exchangeMcp(mcpSession.id, JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {},
            clientInfo: { name: 'docker-ci', version: '1' } },
    }));
    assert.equal(JSON.parse(initialized.message).result.serverInfo.name, 'onebots-mcp');
    assert.deepEqual(await client.exchangeMcp(mcpSession.id,
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'), { message: null });
    const ping = await client.exchangeMcp(mcpSession.id,
        '{"jsonrpc":"2.0","id":2,"method":"ping"}');
    assert.deepEqual(JSON.parse(ping.message), { jsonrpc: '2.0', id: 2, result: {} });

} finally {
    assert.equal((await client.gateway('stop')).status, 'succeeded');
}
assert.ok(sendReceipt);
assert.deepEqual(await client.sendOperation(sendReceipt.id), sendReceipt);
assert.ok(mcpSession);
await assert.rejects(client.pollMcp(mcpSession.id));
await publicStatus('/', 200);
await publicStatus('/ready', 200);
await publicStatus('/mock/bot/onebot/v11/get_login_info', 503);
assert.equal((await client.status()).gateway.desired, 'stopped');
console.log('[onebots] 完整安装、验证、激活、Mock 协议与独立管理服务烟测通过');
