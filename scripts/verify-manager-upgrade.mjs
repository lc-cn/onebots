/** 真实候选下载到本机确认的串联验收；不修改OS服务。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function verifyManagerUpgrade(runtime, archives, temporary) {
    const lib = path.join(runtime, "node_modules/onebots/lib");
    const load = name => import(pathToFileURL(path.join(lib, name)).href);
    const { GenerationStore } = await load("installation/generation-store.js");
    const { createGenerationPlan } = await load("installation/generation-plan.js");
    const { ManagerCandidateInstaller } = await load("manager-runtime/installer.js");
    const { managerCandidateDigest } = await load("manager-runtime/identity.js");
    const { prepareManagerUpgradeWorkspace } = await load("service-upgrade-workspace.js");
    const { acquireControlWorkspace, controlSocket } = await load("control/workspace.js");
    const { createLocalControlClient } = await load("client/local-control.js");
    const home = path.join(temporary, "manager");
    const unlock = acquireControlWorkspace(home);
    let installer;
    let running;
    try {
        const artifact = (name, packName) => {
            const version = JSON.parse(
                fs.readFileSync(path.join(runtime, "node_modules", name, "package.json")),
            ).version;
            const file = path.join(archives, `${packName}-${version}.tgz`);
            return {
                name,
                version,
                spec: `file:${file}`,
                sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            };
        };
        const plan = createGenerationPlan({
            host: artifact("onebots", "onebots"),
            core: artifact("@onebots/core", "onebots-core"),
            extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        });
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({
                root: path.join(home, "versions"),
                isActive: () => false,
            }),
        });
        const operation = await installer.install("actual-manager", plan);
        assert.equal(operation.phase, "verified", `管理候选安装未完成：${operation.phase}`);
        const candidate = installer.readCandidate(operation.candidateId);
        const digest = managerCandidateDigest(candidate);
        assert.deepEqual(await installer.install("actual-manager", plan), operation);
        const workspace = path.join(temporary, "upgrade-workspace");
        fs.mkdirSync(workspace, { mode: 0o700 });
        const canonical = fs.realpathSync(workspace);
        const client = createLocalControlClient(canonical);
        running = await launch(runtime, canonical, temporary);
        assert.equal((await client.status()).gateway.actual, "running");
        await client.pair((await client.bootstrap()).code);
        const auth = fs.readFileSync(path.join(canonical, ".control/auth.json"));
        await running.close();
        running = undefined;
        await prepareManagerUpgradeWorkspace(canonical, {
            schemaVersion: 1,
            operationId: "actual-upgrade",
            candidateDigest: digest,
        });
        running = await launch(candidate.directory, canonical, temporary);
        const status = await client.status();
        assert.equal(status.gateway.actual, "stopped");
        assert.equal(status.gateway.desired, "running");
        await assert.rejects(client.gateway("start"));
        const release = async () => {
            const { manager } = await client.status();
            return post(controlSocket(canonical), {
                managerId: manager.id,
                operationId: "actual-upgrade",
                candidateDigest: digest,
            });
        };
        assert.equal(await release(), 200);
        assert.equal((await client.status()).gateway.actual, "running");
        assert.equal((await client.gateway("stop")).status, "succeeded");
        assert.equal(await release(), 200);
        assert.equal((await client.status()).gateway.desired, "stopped");
        assert.equal((await client.status()).gateway.actual, "stopped");
        assert.deepEqual(fs.readFileSync(path.join(canonical, ".control/auth.json")), auth);
        await running.close();
        running = undefined;
        running = await launch(candidate.directory, canonical, temporary);
        assert.equal(await release(), 200);
        assert.equal((await client.status()).gateway.actual, "stopped");
        await running.close();
        running = undefined;
        process.stdout.write(
            "✓ 真实管理候选：pnpm下载、双验证收据、旧进程退出、维护接管、本地确认、幂等重放及重启保持停止通过（未切换OS服务）\n",
        );
    } finally {
        if (running) await running.close();
        if (installer) await installer.close();
        unlock();
    }
}
async function post(socketPath, body) {
    let request;
    try {
        return await bounded(
            new Promise((resolve, reject) => {
                request = http.request(
                    { socketPath, method: "POST", path: "/api/control/service-upgrade/release" },
                    response => {
                        response.resume();
                        response.once("end", () => resolve(response.statusCode));
                    },
                );
                request.once("error", reject);
                request.end(JSON.stringify(body));
            }),
            15000,
        );
    } finally {
        request?.destroy();
    }
}

async function launch(runtime, workspace, temporary) {
    const entry = path.join(temporary, "manager-acceptance-worker.mjs");
    fs.writeFileSync(
        entry,
        `import { pathToFileURL } from "node:url";
const { startControlHost } = await import(pathToFileURL(process.argv[2] + "/node_modules/onebots/lib/control/host.js").href);
const host = await startControlHost({workspace: process.argv[3], runtimeRoot: process.argv[2], host:"127.0.0.1", port:0,
gatewayEntrypoint: process.argv[2] + "/node_modules/onebots/lib/gateway/entry.js"});
let closing=false;
async function close(){if(closing)return; closing=true; try{await host.close();process.exit(0);}catch{process.exit(1);}}
process.once("message", close); process.once("disconnect", close);
process.send({ready:true});`,
        { mode: 0o600 },
    );
    const env = { PATH: process.env.PATH, HOME: workspace, NODE_ENV: "production" };
    const child = fork(entry, [runtime, workspace], {
        execArgv: [],
        env,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let exited = false;
    const exit = new Promise(resolve =>
        child.once("exit", code => {
            exited = true;
            resolve(code);
        }),
    );
    const close = async () => {
        if (!exited && child.connected) child.send("close");
        const result = await bounded(exit, 30000).catch(error => {
            if (child.connected) child.disconnect();
            child.unref();
            child.channel?.unref();
            throw error;
        });
        assert.equal(result, 0, "管理验收进程未正常退出");
    };
    try {
        await bounded(
            new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", () => reject(new Error("候选管理进程未就绪")));
                child.once("message", value =>
                    value?.ready === true ? resolve() : reject(new Error("候选就绪报文无效")),
                );
            }),
            30000,
        );
    } catch (error) {
        await close();
        throw error;
    }
    return { close };
}
async function bounded(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("管理验收进程结果未确认")), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
