/** 真实npm管理候选至迁移文件切换；OS驱动注入，不注册宿主服务。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function verifyManagerMigration(runtime, archives, temporary) {
    const load = name => import(pathToFileURL(path.join(runtime, "node_modules/onebots/lib", name)).href);
    const { migrateSystemService } = await load("service-migration-coordinator.js");
    const { captureServiceMigration } = await load("service-migration-capture.js");
    const { retainServiceMigrationRuntime } = await load("service-migration-retention.js");
    const { prepareServiceMigrationManagerCandidate } = await load("service-migration-manager-candidate.js");
    const { createServiceMigrationPort } = await load("service-migration-port.js");
    const { FileServiceMigrationJournal } = await load("service-migration-journal.js");
    const { verifyManagerServiceCandidate } = await load("manager-service-upgrade-candidate.js");
    const { acquireControlWorkspace } = await load("control/workspace.js");
    const { getServiceFiles } = await load("service-files.js");
    const { renderSystemdUnit, renderLaunchdPlist } = await load("service-definition.js");
    const home = path.join(fs.realpathSync(temporary), "migration-host");
    const workspace = path.join(home, "workspace");
    const source = path.join(home, "old-install");
    const core = path.join(source, "node_modules/@onebots/core");
    fs.mkdirSync(core, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(workspace, "data"), { recursive: true, mode: 0o700 });
    const write = (file, text) => fs.writeFileSync(file, text, { mode: 0o600 });
    write(path.join(source, "package.json"), JSON.stringify({ name: "onebots", type: "module", dependencies: { "@onebots/core": "1.0.0" } }));
    write(path.join(core, "package.json"), '{"name":"@onebots/core","type":"module"}');
    write(path.join(source, "bin.js"), "export {};\n");
    const node = path.join(home, "old-node");
    fs.copyFileSync(process.execPath, node, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(node, 0o700);
    const legacy = { scope: "user", configPath: path.join(workspace, "old.yaml"),
        nodePath: node, binPath: path.join(source, "bin.js"), workingDirectory: source,
        adapters: [], protocols: [] };
    const host = { platform: process.platform, homedir: home, uid: process.getuid(), env: {},
        exec() { throw new Error("不得执行真实系统命令"); },
        spawn() { throw new Error("不得启动真实系统服务"); } };
    const files = getServiceFiles("user", host);
    for (const directory of [files.stateDir, path.dirname(files.definition)])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const definition = host.platform === "linux" ? renderSystemdUnit(legacy) :
        renderLaunchdPlist(legacy, path.join(files.stateDir, "onebots.log"), path.join(files.stateDir, "onebots-error.log"));
    write(files.definition, definition);
    write(files.metadata, JSON.stringify(legacy));
    const config = "general: {}\n";
    write(legacy.configPath, config);
    write(path.join(workspace, "data/account.fixture"), "original-account-id");
    const target = { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace,
        nodePath: process.execPath, binPath: path.join(runtime, "node_modules/onebots/lib/bin.js"),
        workingDirectory: source, host: "127.0.0.1", port: 6727 };
    const effects = [];
    let state = { state: "stopped", running: false, enabled: true, loaded: true,
        definitionPath: files.definition, processId: null, identity: null, quiescent: true };
    const originalState = structuredClone(state);
    const platform = {
        async inspect() { return structuredClone(state); },
        async quiesce() { effects.push("quiesce"); state.enabled = false; },
        async reload(enabled) { effects.push("reload"); state.enabled = enabled; },
        async start() { throw new Error("已停止的旧服务不能因迁移而启动"); },
    };
    const artifact = (name, prefix) => {
        const version = JSON.parse(fs.readFileSync(path.join(runtime, "node_modules", name, "package.json"))).version;
        const file = path.join(archives, `${prefix}-${version}.tgz`);
        return { name, version, spec: `file:${file}`, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
    };
    const dependencies = { artifacts: { host: artifact("onebots", "onebots"), core: artifact("@onebots/core", "onebots-core") } };
    const id = randomUUID();
    let releaseArtifacts;
    let selected;
    let candidateInput;
    let result;
    try {
        result = await migrateSystemService({ stateDirectory: files.stateDir, id,
            capture: () => captureServiceMigration(target, host, platform),
            retain: backup => retainServiceMigrationRuntime(backup, files.stateDir, id),
            prepareManager: async backup => {
                candidateInput = backup;
                selected = await prepareServiceMigrationManagerCandidate(backup, files.stateDir, id, dependencies);
                assert.deepEqual(effects, []);
                releaseArtifacts = acquireControlWorkspace(path.join(files.stateDir, "manager-artifacts"));
                return selected;
            },
            port: backup => createServiceMigrationPort({ backup, host, platform, operationId: id, originalState }),
        });
        assert.equal(result.status, "succeeded");
        assert.equal(result.recoveryRequired, false);
        assert.deepEqual(effects, ["quiesce", "reload"]);
        verifyManagerServiceCandidate(selected.spec, selected.digest);
    } finally { releaseArtifacts?.(); }
    const journal = new FileServiceMigrationJournal(path.join(files.stateDir, "migrations"));
    const backup = journal.backup(result);
    assert.equal(backup.targetCandidateDigest, selected.digest);
    assert.deepEqual(backup.target, selected.spec);
    assert.deepEqual(JSON.parse(fs.readFileSync(files.metadata)), selected.spec);
    assert.ok(selected.spec.workingDirectory.startsWith(path.join(files.stateDir, "manager-artifacts/versions") + path.sep));
    assert.notEqual(selected.spec.binPath, target.binPath);
    assert.equal(fs.readFileSync(legacy.configPath, "utf8"), config);
    assert.equal(fs.readFileSync(path.join(workspace, "data/account.fixture"), "utf8"), "original-account-id");
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, ".control/gateway.json"))).desired, "stopped");
    assert.deepEqual(await prepareServiceMigrationManagerCandidate(candidateInput, files.stateDir, id, dependencies), selected);
    assert.deepEqual(effects, ["quiesce", "reload"]);
}
