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
    const host = {
        platform: "linux", homedir: home, uid: process.getuid(), env: {},
        exec(command, args) {
            assert.equal(command, process.execPath);
            assert.deepEqual(args, ["--version"]);
            return process.version;
        },
        spawn() { throw new Error("不允许启动 OS 服务"); },
    };
    const files = getServiceFiles("user", host);
    const platform = {
        async inspect() {
            return { state: "stopped", running: false, enabled: true, loaded: true,
                definitionPath: files.definition, processId: null, identity: null, quiescent: true };
        },
        async reload(enabled) { assert.equal(enabled, true); effects.push("reload"); },
        async start() { throw new Error("首次安装不能启动服务"); },
        async quiesce() { throw new Error("首次安装不能停止服务"); },
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
    process.stdout.write("✓ 真实首次安装候选：自带 pnpm 下载、双证明、稳定注册绑定、冷对账及重复只读通过（OS 驱动注入，未安装原生系统服务）\n");
}
