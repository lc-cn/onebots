/** 在全新 CI 容器内执行：docker exec -i <container> node --input-type=module < 此文件。
 * 仅使用公开测试扩展与 Mock 账号；宿主工件由镜像配置，禁止用于生产数据卷。
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
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
await writeFile(configPath, 'plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\n  applications: []\nmock.bot:\n  nickname: CI Mock\n  onebot.v11:\n    use_http: true\n', { mode: 0o600 });
try {
    assert.equal((await client.gateway('restart')).status, 'succeeded');
    const response = await fetch(`${base}/mock/bot/onebot/v11/get_login_info`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
} finally {
    assert.equal((await client.gateway('stop')).status, 'succeeded');
}
await publicStatus('/', 200);
await publicStatus('/ready', 200);
await publicStatus('/mock/bot/onebot/v11/get_login_info', 503);
assert.equal((await client.status()).gateway.desired, 'stopped');
console.log('[onebots] 完整安装、验证、激活、Mock 协议与独立管理服务烟测通过');
