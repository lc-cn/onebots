/** 仅在本仓库 CI 创建的可丢弃容器卷内执行，禁止用于生产工作区。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createLocalControlClient } from '/app/packages/onebots/lib/client/local-control.js';
import { ControlClient, createHttpControlTransport } from '/app/packages/core/lib/control.js';

assert.equal(process.env.CONTROL_VERIFY_REPAIR, 'disposable-ci-volume');
const local = createLocalControlClient('/data');
const initial = await local.status();
assert.equal(initial.gateway.desired, 'stopped');
assert.equal(initial.gateway.actual, 'stopped');
let token = '';
const web = new ControlClient(createHttpControlTransport('http://127.0.0.1:6727', () => token));
token = (await web.pair((await local.bootstrap()).code)).token;
for (const desired of ['stopped', 'running']) {
    const original = Buffer.from('secret: "修复验收原始内容\r\nbroken: [\r\n');
    fs.writeFileSync('/data/config.yaml', original, { mode: 0o600 });
    if (desired === 'running') {
        assert.equal((await web.gateway('start')).status, 'failed');
        assert.equal((await web.status()).gateway.recoveryRequired, false);
    }
    assert.equal((await fetch('http://127.0.0.1:6727/ready')).status, 200);
    const source = await web.configurationSource();
    assert.equal(source.state, 'damaged');
    assert.equal(JSON.stringify(source).includes('原始内容'), false);
    const context = await web.createConfigurationRepairDraft(source.base);
    assert.equal(JSON.stringify(context).includes('backupId'), false);
    assert.deepEqual(fs.readFileSync('/data/config.yaml'), original);
    const validation = await web.validateConfigurationDraft(context.draft.id, context.draft.revision);
    assert.equal(validation.valid, true);
    const id = `ci-repair-${randomUUID()}`;
    assert.equal((await web.applyConfiguration(id, validation.receiptId)).status, 'succeeded');
    assert.equal((await web.applyConfiguration(id, validation.receiptId)).status, 'succeeded');
    assert.equal((await web.configurationSource()).state, 'ready');
    const status = await web.status();
    assert.equal(status.manager.id, initial.manager.id);
    assert.equal(status.gateway.desired, desired);
    assert.equal(status.gateway.actual, desired);
    const backups = '/data/.control/configuration/recovery';
    assert.ok(fs.readdirSync(backups).some(name => {
        const file = `${backups}/${name}`;
        return fs.readFileSync(file).equals(original) && (fs.statSync(file).mode & 0o777) === 0o400;
    }));
    assert.equal((await web.gateway('stop')).status, 'succeeded');
}
console.log('[onebots] Docker 损坏配置、私有原文备份、HTTP 修复与启停意图验收通过');
