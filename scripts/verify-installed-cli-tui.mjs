/**
 * Pack and install the published OneBots surface, then exercise one shared manager workspace
 * through the installed CLI and the same TUI command entry used by `onebots ui`.
 *
 * The fixture injects only trusted local release artifacts into the manager host. All product
 * mutations go through the public command entries and their local ControlClient transport.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync("/tmp/ob-installed-entries-");
const archives = path.join(temporary, "archives");
const runtime = path.join(temporary, "runtime");
const workspace = path.join(temporary, "workspace");
for (const directory of [archives, runtime, workspace])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const packageSources = new Map([
    ["@onebots/core", path.join(root, "packages/core")],
    ["@onebots/web", path.join(root, "packages/web")],
    ["onebots", path.join(root, "packages/onebots")],
    ["@onebots/adapter-mock", path.join(root, "adapters/adapter-mock")],
    ["@onebots/protocol-onebot-v11", path.join(root, "protocols/onebot-v11/protocol")],
]);
const environment = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: path.join(temporary, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global-npmrc"),
    NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
};
fs.writeFileSync(environment.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
fs.writeFileSync(environment.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });

let host;
let safeToRemove = true;
try {
    const artifacts = new Map();
    for (const [name, directory] of packageSources) {
        execFileSync("pnpm", ["pack", "--pack-destination", archives], {
            cwd: directory,
            env: process.env,
            stdio: ["ignore", "ignore", "pipe"],
        });
        const candidates = fs
            .readdirSync(archives)
            .filter(
                file =>
                    file.endsWith(".tgz") && ![...artifacts.values()].some(x => x.file === file),
            );
        assert.equal(candidates.length, 1, `无法唯一确认 ${name} 的打包工件`);
        const file = path.join(archives, candidates[0]);
        const manifest = JSON.parse(execFileSync("tar", ["-xOf", file, "package/package.json"]));
        assert.equal(manifest.name, name);
        artifacts.set(name, {
            name,
            version: manifest.version,
            spec: `file:${file}`,
            sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            file: candidates[0],
            manifest,
        });
    }

    fs.writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({ name: "onebots-installed-entry-verification", private: true }),
    );
    execFileSync(
        "npm",
        [
            "install",
            "--omit=dev",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--save-exact",
            artifacts.get("@onebots/core").spec,
            artifacts.get("@onebots/web").spec,
            artifacts.get("onebots").spec,
        ],
        { cwd: runtime, env: environment, stdio: ["ignore", "ignore", "pipe"] },
    );

    const packageRoot = path.join(runtime, "node_modules/onebots");
    const bin = path.join(packageRoot, "lib/bin.js");
    const { startControlHost } = await import(
        pathToFileURL(path.join(packageRoot, "lib/control/host.js")).href
    );
    const resolverArtifacts = Object.fromEntries(
        ["@onebots/adapter-mock", "@onebots/protocol-onebot-v11"].map(name => {
            const { file: _file, manifest: _manifest, ...artifact } = artifacts.get(name);
            return [name, artifact];
        }),
    );
    const hostArtifact = (({ file: _file, manifest: _manifest, ...artifact }) => artifact)(
        artifacts.get("onebots"),
    );
    const coreArtifact = (({ file: _file, manifest: _manifest, ...artifact }) => artifact)(
        artifacts.get("@onebots/core"),
    );
    safeToRemove = false;
    host = await startControlHost({
        workspace,
        host: "127.0.0.1",
        port: 0,
        runtimeRoot: runtime,
        gatewayEntrypoint: path.join(packageRoot, "lib/gateway/entry.js"),
        installation: {
            resolver: {
                host: hostArtifact,
                core: coreArtifact,
                extensionVersions: Object.fromEntries(
                    Object.entries(resolverArtifacts).map(([name, artifact]) => [
                        name,
                        artifact.version,
                    ]),
                ),
                artifacts: resolverArtifacts,
                fetchMetadata: async (name, version) => {
                    const artifact = artifacts.get(name);
                    assert.equal(artifact?.version, version);
                    return structuredClone(artifact.manifest);
                },
            },
        },
    });

    async function cli(args, input) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [bin, ...args], {
                cwd: runtime,
                env: environment,
                stdio: ["pipe", "pipe", "pipe"],
            });
            const stdout = [];
            const stderr = [];
            let size = 0;
            const timer = setTimeout(() => child.kill("SIGKILL"), 12 * 60_000);
            const collect = target => chunk => {
                size += chunk.length;
                if (size > 4 * 1024 * 1024) child.kill("SIGKILL");
                else target.push(chunk);
            };
            child.stdout.on("data", collect(stdout));
            child.stderr.on("data", collect(stderr));
            child.once("error", reject);
            child.once("close", code => {
                clearTimeout(timer);
                const output = Buffer.concat(stdout).toString("utf8").trim();
                if (code === 0) resolve(output);
                else
                    reject(
                        new Error(`CLI 退出 ${code}：${Buffer.concat(stderr).toString("utf8")}`),
                    );
            });
            child.stdin.end(input);
        });
    }
    async function json(args, input) {
        return JSON.parse(await cli(args, input));
    }
    const data = ["--data-dir", workspace];
    const initial = await json(["control", "status", ...data]);
    assert.equal(initial.gateway.actual, "running");

    const plan = await json([
        "control",
        "plan",
        ...data,
        "--adapters",
        "mock",
        "--protocols",
        "onebot-v11",
    ]);
    assert.deepEqual(plan.selection, {
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        applications: [],
    });
    const installId = `cli-install-${randomUUID()}`;
    await json(["control", "install", ...data, "--plan", plan.id, "--request", installId]);
    let installation;
    const installationDeadline = Date.now() + 10 * 60_000;
    while (Date.now() < installationDeadline) {
        installation = await json(["control", "installation", ...data, "--request", installId]);
        if (["verified", "failed", "interrupted"].includes(installation.phase)) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(installation?.phase, "verified");
    assert.ok(installation.candidateId);
    assert.equal(
        (await json(["control", "activate", ...data, "--generation", installation.candidateId]))
            .status,
        "succeeded",
    );

    const draft = await json(["control", "config", "create", ...data]);
    const account = await json(
        ["control", "config", "add-account", ...data, "--draft", draft.id, "--stdin"],
        JSON.stringify({
            expectedRevision: draft.revision,
            platform: "mock",
            accountId: "installed-entry",
        }),
    );
    const protocol = await json(
        ["control", "config", "protocol", ...data, "--draft", draft.id, "--stdin"],
        JSON.stringify({
            expectedRevision: account.revision,
            accountKey: "mock.installed-entry",
            protocol: "onebot.v11",
            enabled: true,
        }),
    );
    const validation = await json([
        "control",
        "config",
        "validate",
        ...data,
        "--draft",
        draft.id,
        "--revision",
        protocol.revision,
    ]);
    assert.equal(validation.valid, true);
    assert.ok(validation.receiptId);
    const applyId = `cli-apply-${randomUUID()}`;
    const applied = await json([
        "control",
        "config",
        "apply",
        ...data,
        "--request",
        applyId,
        "--receipt",
        validation.receiptId,
    ]);
    assert.equal(applied.status, "succeeded");
    assert.deepEqual(
        await json(["control", "config", "operation", ...data, "--request", applyId]),
        applied,
    );

    for (const action of ["stop", "start", "restart"])
        assert.equal((await json(["control", action, ...data])).status, "succeeded");
    const afterCli = await json(["control", "status", ...data]);
    assert.equal(afterCli.gateway.actual, "running");
    assert.equal(afterCli.gateway.desired, "running");
    const cliInstanceId = afterCli.gateway.instance?.id;
    assert.ok(cliInstanceId);
    const sendId = randomUUID();
    const sent = await json([
        "send",
        ...data,
        "--account",
        "mock/installed-entry",
        "--target-type",
        "private",
        "--target-id-type",
        "number",
        "--operation-id",
        sendId,
        "--json",
        "123",
        "installed-entry-message",
    ]);
    assert.equal(sent.status, "succeeded");
    assert.equal(
        (await json(["send", ...data, "--operation-id", sendId, "--json"])).status,
        "succeeded",
    );

    const reports = [];
    const mainActions = [["status"], ["restart"], ["status"], ["track"], ["configure"], ["quit"]];
    const prompt = {
        async ask(request) {
            if (request.title === "OneBots 管理工作台") return mainActions.shift() ?? ["quit"];
            if (request.title === "输入已有安装任务 ID") return [installId];
            if (request.title === "激活已验证运行版本？") return ["no"];
            if (request.title === "配置草稿") return ["operation"];
            if (request.title === "输入配置应用任务 ID") return [applyId];
            throw new Error(`未预期的 TUI 提示：${request.title}`);
        },
        report(message) {
            reports.push(message);
        },
    };
    const { runControlTuiCommand } = await import(
        pathToFileURL(path.join(packageRoot, "lib/control/tui-command.js")).href
    );
    await runControlTuiCommand(data, { interactive: true, prompt });
    assert.ok(reports.some(message => message.includes("网关：running，期望：running")));
    assert.ok(reports.some(message => message === "操作完成，管理服务保持在线。"));
    assert.ok(reports.some(message => message.includes(`任务 ${installId}：verified`)));
    assert.ok(reports.some(message => message.includes(`应用任务 ${applyId}：succeeded`)));
    const afterTui = await json(["control", "status", ...data]);
    assert.equal(afterTui.gateway.actual, "running");
    assert.equal(afterTui.gateway.desired, "running");
    assert.notEqual(afterTui.gateway.instance?.id, cliInstanceId, "TUI restart 必须替换网关实例");

    const operationLog = await cli(["control", "logs", ...data, "--source", "operation"]);
    assert.match(operationLog, new RegExp(installId));
    assert.match(operationLog, new RegExp(applyId));
    assert.match(operationLog, new RegExp(sendId));
    for (const action of [
        "installation.install",
        "generation.activate",
        "configuration.apply",
        "message.send",
        "stop",
        "start",
        "restart",
    ])
        assert.match(operationLog, new RegExp(`\\"action\\":\\"${action}\\"`));
    assert.doesNotMatch(operationLog, /installed-entry-message/);

    await host.close();
    host = undefined;
    safeToRemove = true;
    process.stdout.write(
        "✓ 已安装产物的 CLI 完成计划、安装、激活、配置、发送与启停；TUI 命令入口重启同一网关并读取安装任务、配置任务及统一操作日志\n",
    );
} finally {
    if (host) {
        await host.close();
        safeToRemove = true;
    }
    if (safeToRemove) fs.rmSync(temporary, { recursive: true, force: true });
    else process.stderr.write(`验收状态未确认，保留临时目录 ${temporary}\n`);
}
