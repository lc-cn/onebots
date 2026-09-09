/** 真实候选下载/证明/首次注册/冷对账；OS 驱动注入，不安装宿主系统服务。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function verifyManagerBootstrap(runtime, archives, temporary) {
    const load = name => import(pathToFileURL(path.join(runtime, "node_modules/onebots/lib", name)).href);
    const { bootstrapManagerService } = await load("manager-service-bootstrap.js");
    const { reconcileManagerServiceOperation } = await load("manager-service-recovery.js");
    const { FileManagerServiceJournal } = await load("manager-service-journal.js");
    const { getServiceFiles } = await load("service-files.js");
    const home = path.join(fs.realpathSync(temporary), "bootstrap-host");
    fs.mkdirSync(home, { mode: 0o700 });
    const workspace = path.join(home, "data");
    const effects = [];
    let unregistered = false;
    const host = {
        platform: "linux", homedir: home, uid: process.getuid(), env: {},
        exec(command, args) {
            if (command === "systemctl" && args.includes("show")) {
                assert.equal(unregistered, true);
                return "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n";
            }
            assert.equal(command, process.execPath);
            assert.deepEqual(args, ["--version"]);
            return process.version;
        },
        spawn() { throw new Error("不允许启动 OS 服务"); },
    };
    const files = getServiceFiles("user", host);
    let enabled = true;
    const platform = {
        async inspect() {
            return { state: "stopped", running: false, enabled, loaded: true,
                definitionPath: files.definition, processId: null, identity: null, quiescent: true };
        },
        async reload(value) { assert.equal(value, true); enabled = value; effects.push("reload"); },
        async start() { throw new Error("首次安装不能启动服务"); },
        async quiesce() { enabled = false; effects.push("quiesce"); },
    };
    const artifact = (name, prefix) => {
        const version = JSON.parse(fs.readFileSync(path.join(runtime, "node_modules", name, "package.json"))).version;
        const file = path.join(archives, `${prefix}-${version}.tgz`);
        return { name, version, spec: `file:${file}`,
            sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
    };
    const request = { id: "initial-install", service: { schemaVersion: 1, runtimeKind: "control",
        scope: "user", workspace, nodePath: process.execPath, host: "127.0.0.1", port: 6727 } };
    const dependencies = { platform, assertAbsent: () => {}, artifacts: {
        host: artifact("onebots", "onebots"), core: artifact("@onebots/core", "onebots-core"),
    } };
    const result = await bootstrapManagerService(request, dependencies, host);
    assert.equal(result.status, "succeeded");
    assert.equal(result.id, request.id);
    assert.ok(result.managerSpec.workingDirectory.startsWith(path.join(files.stateDir, "manager-artifacts/versions") + path.sep));
    assert.equal(fs.existsSync(path.join(workspace, "config.yaml")), false);
    const definition = fs.readFileSync(files.definition);
    const metadata = fs.readFileSync(files.metadata);
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    assert.deepEqual(effects, ["reload"]);
    const journal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    journal.save({ ...result, status: "interrupted", recoveryRequired: true });
    const recovered = await reconcileManagerServiceOperation(request.id, "user", host, { platform });
    assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.recoveryRequired, false);
    assert.deepEqual(await bootstrapManagerService(request, dependencies, host), recovered);
    assert.deepEqual(effects, ["reload"]);
    assert.deepEqual(fs.readFileSync(files.definition), definition);
    assert.deepEqual(fs.readFileSync(files.metadata), metadata);
    assert.deepEqual(fs.readFileSync(path.join(workspace, ".control/gateway.json")), gateway);
    assert.equal(fs.existsSync(path.join(workspace, "config.yaml")), false);
    // 从首次安装的真实候选升级到另一份独立候选，不使用模拟候选证明。
    const { ManagerCandidateInstaller } = await load("manager-runtime/installer.js");
    const { GenerationStore } = await load("installation/generation-store.js");
    const { createGenerationPlan } = await load("installation/generation-plan.js");
    const { bundledPnpmExecutor } = await load("installation/bundled-runtime-artifacts.js");
    const { acquireControlWorkspace } = await load("control/workspace.js");
    const { managerCandidateDigest } = await load("manager-runtime/identity.js");
    const { upgradeManagerService } = await load("manager-service-upgrade.js");
    const targetHome = path.join(home, "upgrade-artifacts");
    const unlock = acquireControlWorkspace(targetHome);
    let installer;
    let candidate;
    try {
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(targetHome, "operations"),
            store: new GenerationStore({ root: path.join(targetHome, "versions"), isActive: () => false }),
            ...bundledPnpmExecutor(),
        });
        const installed = await installer.install("next-manager", createGenerationPlan({
            ...dependencies.artifacts, extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        }));
        assert.equal(installed.phase, "verified");
        candidate = installer.readCandidate(installed.candidateId);
    } finally {
        try { await installer?.close(); } finally { unlock(); }
    }
    const upgraded = await upgradeManagerService({ id: "installed-manager-upgrade", scope: "user",
        candidateDirectory: candidate.directory, candidateDigest: managerCandidateDigest(candidate),
    }, host, { platform });
    assert.equal(upgraded.status, "succeeded");
    assert.deepEqual(effects, ["reload", "quiesce", "reload"]);
    assert.equal(JSON.parse(fs.readFileSync(files.metadata)).workingDirectory, candidate.directory);
    assert.notDeepEqual(fs.readFileSync(files.definition), definition);
    assert.deepEqual(fs.readFileSync(path.join(workspace, ".control/gateway.json")), gateway);
    assert.equal(fs.existsSync(path.join(workspace, "config.yaml")), false);
    // 首次安装旧回执不能覆盖升级后的服务契约，也不能重复安装旧候选。
    await assert.rejects(bootstrapManagerService(request, dependencies, host));
    assert.deepEqual(effects, ["reload", "quiesce", "reload"]);
    const { uninstallManagerService } = await load("manager-service-uninstall.js");
    const candidateProof = fs.readFileSync(path.join(candidate.directory, "manager-verification.json"));
    const removed = await uninstallManagerService("user", host, { platform,
        unregister: () => { unregistered = true; effects.push("unregister"); },
    });
    assert.equal(removed.status, "succeeded");
    assert.equal(fs.existsSync(files.definition), false);
    assert.equal(fs.existsSync(files.metadata), false);
    assert.deepEqual(fs.readFileSync(path.join(candidate.directory, "manager-verification.json")), candidateProof);
    assert.deepEqual(fs.readFileSync(path.join(workspace, ".control/gateway.json")), gateway);
    const removalJournal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    removalJournal.save({ ...removed, status: "interrupted", recoveryRequired: true });
    const effectsAfterRemoval = [...effects];
    assert.equal((await reconcileManagerServiceOperation(removed.id, "user", host)).status, "succeeded");
    assert.deepEqual(effects, effectsAfterRemoval);
    assert.equal(fs.existsSync(files.definition), false);
    assert.equal(fs.existsSync(files.metadata), false);
    await assert.rejects(bootstrapManagerService(request, dependencies, host));
    assert.deepEqual(effects, effectsAfterRemoval);
    const initialBinding = path.join(files.stateDir, "manager-artifacts/bootstrap");
    const initialIntent = fs.readFileSync(path.join(initialBinding, "intent.json"));
    const initialCandidate = fs.readFileSync(path.join(initialBinding, "candidate.json"));
    const nextRequest = { ...request, id: "reinstalled-manager" };
    const reinstalled = await bootstrapManagerService(nextRequest, dependencies, host);
    assert.equal(reinstalled.status, "succeeded");
    assert.notEqual(reinstalled.managerSpec.workingDirectory, result.managerSpec.workingDirectory);
    assert.deepEqual(fs.readFileSync(path.join(initialBinding, "intent.json")), initialIntent);
    assert.deepEqual(fs.readFileSync(path.join(initialBinding, "candidate.json")), initialCandidate);
    assert.deepEqual(fs.readFileSync(path.join(workspace, ".control/gateway.json")), gateway);
    const cycleJournal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    cycleJournal.save({ ...reinstalled, status: "interrupted", recoveryRequired: true });
    const newCycle = await reconcileManagerServiceOperation(nextRequest.id, "user", host, { platform });
    assert.equal(newCycle.status, "succeeded");
    assert.deepEqual(await bootstrapManagerService(nextRequest, dependencies, host), newCycle);
    assert.deepEqual(effects, [...effectsAfterRemoval, "reload"]);
    await assert.rejects(reconcileManagerServiceOperation(request.id, "user", host, { platform }));
    assert.deepEqual(effects, [...effectsAfterRemoval, "reload"]);
    process.stdout.write("✓ 真实首次安装候选：自带 pnpm 下载、双证明、稳定注册绑定、冷对账、重复只读、另一真实候选升级、卸载保留数据及卸载冷对账及独立安装周期通过（OS 驱动注入，未安装原生系统服务）\n");
}
