/**
 * GitHub-hosted Ubuntu runner 上的真实 systemd 验收。
 *
 * 固定系统服务名意味着本脚本不能与任何既有 OneBots 安装共享主机。只有 root、GitHub Actions
 * 和显式 ONEBOTS_SYSTEMD_ACCEPTANCE=1 同时成立时才允许执行；任何未知结果都保留现场，不重派动作。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVICE = "onebots-gateway.service";
const DEFINITION = `/etc/systemd/system/${SERVICE}`;
const STATE_DIRECTORY = "/var/lib/onebots";
const METADATA = `${STATE_DIRECTORY}/service.json`;

assert.equal(process.platform, "linux", "真实 systemd 验收只允许在 Linux 运行");
assert.equal(process.getuid?.(), 0, "真实 systemd 验收必须以 root 运行");
assert.equal(process.env.CI, "true", "真实 systemd 验收只允许在 CI 运行");
assert.equal(process.env.GITHUB_ACTIONS, "true", "真实 systemd 验收只允许在 GitHub Actions 运行");
assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    "github-hosted",
    "真实 systemd 验收拒绝会保留系统副作用的 self-hosted runner",
);
assert.equal(
    process.env.ONEBOTS_SYSTEMD_ACCEPTANCE,
    "1",
    "必须显式设置 ONEBOTS_SYSTEMD_ACCEPTANCE=1",
);
assert.equal(fs.existsSync("/run/systemd/system"), true, "runner 未运行 systemd");

const { SERVICE_NAME } = await import(
    path.join(ROOT, "packages/onebots/lib/service-definition.js")
);
assert.equal(`${SERVICE_NAME}.service`, SERVICE, "验收固定 unit 名与当前构建不一致");

function execute(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? ROOT,
        env: options.env ?? process.env,
        encoding: "utf8",
        timeout: options.timeout ?? 300_000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || !(options.statuses ?? [0]).includes(result.status ?? -1))
        throw new Error(
            `验收命令失败：${path.basename(command)} ${args[0] ?? ""}（exit ${String(result.status)}）`,
        );
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function systemdUnit() {
    const output = execute(
        "systemctl",
        ["show", SERVICE, "--no-pager", "--property=LoadState", "--property=FragmentPath"],
        { statuses: [0] },
    ).stdout;
    return Object.fromEntries(
        output
            .split(/\r?\n/u)
            .filter(Boolean)
            .map(line => {
                const separator = line.indexOf("=");
                return [line.slice(0, separator), line.slice(separator + 1)];
            }),
    );
}

function assertSystemServiceAbsent() {
    const unit = systemdUnit();
    assert.equal(unit.LoadState, "not-found", "固定 OneBots systemd unit 已存在");
    assert.equal(unit.FragmentPath, "", "固定 OneBots systemd definition 已存在");
    assert.equal(fs.existsSync(DEFINITION), false, "固定 OneBots systemd 文件已存在");
    assert.equal(fs.existsSync(METADATA), false, "固定 OneBots system metadata 已存在");
}

// 任何打包或安装动作之前先证明固定服务及整个系统状态目录均不存在。
assertSystemServiceAbsent();
assert.equal(fs.existsSync(STATE_DIRECTORY), false, "固定 OneBots system state directory 已存在");
assert.equal(
    execute("pnpm", ["--version"], { statuses: [0] }).stdout,
    "9.15.9",
    "真实 systemd 验收必须使用 pnpm 9.15.9",
);

const temporary = fs.realpathSync(fs.mkdtempSync("/tmp/onebots-systemd-acceptance-"));
const artifacts = path.join(temporary, "artifacts");
const runtime = path.join(temporary, "runtime");
const dataDirectory = path.join(temporary, "data");
const npmUserConfig = path.join(temporary, "user.npmrc");
const npmGlobalConfig = path.join(temporary, "global.npmrc");
fs.mkdirSync(runtime, { mode: 0o700 });
fs.writeFileSync(npmUserConfig, "", { mode: 0o600 });
fs.writeFileSync(npmGlobalConfig, "", { mode: 0o600 });
assert.equal(fs.existsSync(dataDirectory), false, "隔离 data-dir 必须从空缺状态开始");

const npmEnvironment = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
    NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
};

execute(process.execPath, ["scripts/pack-control-runtime.mjs", artifacts], {
    statuses: [0],
});
execute("pnpm", ["pack", "--pack-destination", artifacts], {
    cwd: path.join(ROOT, "packages/web"),
    statuses: [0],
});
const tarballs = fs
    .readdirSync(artifacts)
    .filter(name => name.endsWith(".tgz"))
    .map(name => path.join(artifacts, name));
assert.equal(tarballs.length, 3, "必须安装当前 core、web 和 onebots 三个打包工件");
const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, "manifest.json"), "utf8"));
fs.writeFileSync(
    path.join(runtime, "package.json"),
    JSON.stringify({ name: "onebots-systemd-acceptance", private: true, version: "1.0.0" }),
    { mode: 0o600 },
);
execute(
    "npm",
    [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "--registry=https://registry.npmjs.org",
        ...tarballs,
    ],
    { cwd: runtime, env: npmEnvironment, statuses: [0] },
);

const cli = path.join(runtime, "node_modules/.bin/onebots");
const cliStat = fs.lstatSync(cli);
assert.equal(cliStat.isFile() || cliStat.isSymbolicLink(), true);
assert.equal(
    JSON.parse(fs.readFileSync(path.join(runtime, "node_modules/onebots/package.json"), "utf8"))
        .version,
    manifest.host.version,
);
assert.equal(
    JSON.parse(
        fs.readFileSync(path.join(runtime, "node_modules/@onebots/core/package.json"), "utf8"),
    ).version,
    manifest.core.version,
);
const cliEnvironment = {
    ...npmEnvironment,
    LANG: "C",
    NO_COLOR: "1",
    ONEBOTS_RUNTIME_ARTIFACTS: path.join(artifacts, "manifest.json"),
};

const { renderSystemdUnit } = await import(
    path.join(runtime, "node_modules/onebots/lib/service-definition.js")
);

function invokeCli(args, statuses = [0]) {
    return execute(cli, args, {
        cwd: runtime,
        env: cliEnvironment,
        statuses,
        timeout: 300_000,
    });
}

function cliJson(args, statuses = [0]) {
    const result = invokeCli(args, statuses);
    try {
        return JSON.parse(result.stdout);
    } catch {
        throw new Error(`公开 CLI 未输出合法 JSON：onebots ${args[0] ?? ""}`);
    }
}

function operation(output, action) {
    const match = output.match(/操作 ([A-Za-z0-9_-]{1,128})：succeeded（completed）/u);
    assert.ok(match, `公开 CLI ${action} 未返回已完成操作 ID`);
    return match[1];
}

function migrationJournalStates() {
    const directory = path.join(STATE_DIRECTORY, "migrations");
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory)
        .filter(name => name.endsWith(".journal.json"))
        .map(name => {
            try {
                const value = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
                const safe = field =>
                    typeof field === "string" && /^[a-z-]{1,64}$/u.test(field) ? field : "invalid";
                return { phase: safe(value.phase), status: safe(value.status) };
            } catch {
                return { phase: "unreadable", status: "unreadable" };
            }
        });
}

function migrationCaptureState() {
    const migrations = path.join(STATE_DIRECTORY, "migrations");
    if (!fs.existsSync(migrations)) return { operation: false };
    const ids = fs
        .readdirSync(migrations)
        .map(name => /^([0-9a-f-]{36})\.journal\.json$/iu.exec(name)?.[1])
        .filter(Boolean);
    if (ids.length !== 1) return { operation: ids.length === 1 };
    const id = ids[0];
    const inspect = kind => {
        const directory = path.join(STATE_DIRECTORY, "legacy-runtime-artifacts", kind);
        try {
            const stat = fs.lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) return { store: "invalid" };
            const names = fs.readdirSync(directory);
            return {
                store: "directory",
                finalized: names.includes(id),
                candidates: names.filter(name => name.startsWith(`.${id}-`)).length,
            };
        } catch (error) {
            return {
                store: error?.code === "ENOENT" ? "missing" : "unreadable",
            };
        }
    };
    return { operation: true, programs: inspect("programs"), nodes: inspect("nodes") };
}

async function linuxNodeCaptureState() {
    const systemRoot = target =>
        ["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some(root => target.startsWith(root));
    let preload = "missing";
    try {
        preload = fs.readFileSync("/etc/ld.so.preload", "utf8").trim() ? "nonempty" : "empty";
    } catch (error) {
        if (error?.code !== "ENOENT") preload = "unreadable";
    }
    let nativeValidation = "failed";
    try {
        const { assertSystemNativeDependencies } = await import(
            path.join(runtime, "node_modules/onebots/lib/service-migration-native-dependencies.js")
        );
        await assertSystemNativeDependencies(fs.realpathSync(process.execPath));
        nativeValidation = "passed";
    } catch {
        // 诊断只暴露固定分类，不透传 ELF、loader 输出或路径。
    }
    let needed = "unavailable";
    let nonSystemCacheTargets = "unavailable";
    try {
        const dynamic = execute("/usr/bin/readelf", ["-d", fs.realpathSync(process.execPath)], {
            statuses: [0],
        }).stdout;
        const names = new Set(
            [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)].map(match => match[1]),
        );
        const cache = execute("/sbin/ldconfig", ["-p"], { statuses: [0] }).stdout;
        const targets = cache
            .split(/\r?\n/u)
            .map(line => /^\s+(\S+) \([^)]+\) => (\S+)$/u.exec(line))
            .filter(match => match && names.has(match[1]))
            .map(match => match[2]);
        needed = names.size;
        nonSystemCacheTargets = targets.filter(target => !systemRoot(target)).length;
    } catch {
        // 工具缺失同样只记固定分类。
    }
    return { preload, nativeValidation, needed, nonSystemCacheTargets };
}

async function invokeMigration(args) {
    const result = invokeCli(args, [0, 1]);
    if (result.status === 0) return result.stdout;
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4096);
    throw new Error(
        `公开 CLI migrate 失败（exit ${String(result.status)}）：${text || "无输出"}；迁移记录=${JSON.stringify(migrationJournalStates())}；捕获阶段=${JSON.stringify(migrationCaptureState())}；Node捕获=${JSON.stringify(await linuxNodeCaptureState())}`,
    );
}

function systemdState() {
    return execute(
        "systemctl",
        [
            "show",
            SERVICE,
            "--no-pager",
            "--property=LoadState",
            "--property=ActiveState",
            "--property=SubState",
            "--property=Result",
            "--property=ExecMainCode",
            "--property=ExecMainStatus",
            "--property=MainPID",
        ],
        { statuses: [0] },
    ).stdout;
}

async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
    );
    return address.port;
}

async function eventually(read, accept, message) {
    let last;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            last = await read();
            if (await accept(last)) return last;
        } catch {
            // systemd 与 IPC 切换存在短暂窗口；只做有界只读重试，不重派生命周期动作。
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(message);
}

async function assertManagementOnline(port) {
    await eventually(
        () => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }),
        response => response.status === 200,
        "管理端未在截止时间内上线",
    );
}

async function verifyLegacyMigration(port, operationIds) {
    let legacyRuntime = path.join(temporary, "legacy-systemd-runtime");
    let legacyData = path.join(temporary, "legacy-systemd-data");
    const legacyCore = path.join(legacyRuntime, "node_modules/@onebots/core");
    fs.mkdirSync(legacyCore, { recursive: true, mode: 0o700 });
    fs.mkdirSync(legacyData, { recursive: true, mode: 0o700 });
    legacyRuntime = fs.realpathSync(legacyRuntime);
    legacyData = fs.realpathSync(legacyData);
    fs.writeFileSync(
        path.join(legacyRuntime, "package.json"),
        JSON.stringify({
            name: "onebots",
            private: true,
            version: "1.0.0",
            type: "module",
            dependencies: { "@onebots/core": "1.0.0" },
        }),
        { mode: 0o600 },
    );
    fs.writeFileSync(
        path.join(legacyCore, "package.json"),
        JSON.stringify({ name: "@onebots/core", private: true, version: "1.0.0" }),
        { mode: 0o600 },
    );
    let legacyBin = path.join(legacyRuntime, "bin.js");
    const readyMarker = path.join(legacyData, "legacy-ready");
    fs.writeFileSync(
        legacyBin,
        `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready\\n", { mode: 0o600 }); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 60_000);\n`,
        { mode: 0o600 },
    );
    legacyBin = fs.realpathSync(legacyBin);
    let legacyConfig = path.join(legacyData, "config.yaml");
    fs.writeFileSync(legacyConfig, "general: {}\n", { mode: 0o600 });
    legacyConfig = fs.realpathSync(legacyConfig);
    fs.writeFileSync(path.join(legacyData, "acceptance-user-data.txt"), "legacy-preserve-me\n", {
        mode: 0o600,
    });
    const legacy = {
        scope: "system",
        configPath: legacyConfig,
        adapters: [],
        protocols: [],
        applications: [],
        nodePath: fs.realpathSync(process.execPath),
        binPath: legacyBin,
        workingDirectory: legacyRuntime,
    };
    fs.mkdirSync(STATE_DIRECTORY, { recursive: true, mode: 0o700 });
    fs.writeFileSync(METADATA, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    fs.writeFileSync(DEFINITION, renderSystemdUnit(legacy), { mode: 0o600 });
    execute("systemctl", ["daemon-reload"]);
    execute("systemctl", ["enable", "--now", SERVICE]);
    try {
        await eventually(
            () => ({
                active: execute("systemctl", ["is-active", SERVICE], {
                    statuses: [0, 3],
                }).stdout,
                ready: fs.existsSync(readyMarker),
            }),
            value => value.active === "active" && value.ready,
            "旧 systemd 服务未稳定运行或未执行真实入口",
        );
    } catch (error) {
        throw new Error(`${error.message}；OS 状态：${systemdState()}`);
    }
    const legacyStatus = cliJson(["status", "--system", "--json"], [1]);
    assert.equal(legacyStatus.installation, "legacy");
    assert.equal(legacyStatus.diagnostic, "migration-required");

    const migrationOutput = await invokeMigration([
        "migrate",
        "--system",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
    ]);
    const migrationId = operation(migrationOutput, "migrate");
    operationIds.push(migrationId);
    const migrationJournal = path.join(
        STATE_DIRECTORY,
        "migrations",
        `${migrationId}.journal.json`,
    );
    const journalBeforeColdStart = fs.readFileSync(migrationJournal);
    const beforeColdStart = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", legacyData]),
        }),
        value =>
            value.os.installation === "control" &&
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "旧 systemd 服务迁移后管理进程或网关未稳定运行",
    );
    assert.equal(
        JSON.parse(journalBeforeColdStart).id,
        migrationId,
        "迁移完成记录必须持久化公开 CLI 返回的 operation ID",
    );
    await assertManagementOnline(port);

    execute("systemctl", ["kill", "--kill-who=all", "--signal=SIGKILL", SERVICE]);
    const afterColdStart = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", legacyData]),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.os.manager.pid !== beforeColdStart.os.manager.pid &&
            value.control.manager.id !== beforeColdStart.control.manager.id &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running" &&
            value.control.gateway.instance?.id !== beforeColdStart.control.gateway.instance?.id,
        "systemd 未在管理进程异常退出后完成冷启动恢复",
    );
    assert.ok(afterColdStart.os.manager.pid);
    assert.deepEqual(
        fs.readFileSync(migrationJournal),
        journalBeforeColdStart,
        "冷启动不得改写或重派已完成的迁移 operation",
    );
    assert.equal(
        fs.readFileSync(path.join(legacyData, "acceptance-user-data.txt"), "utf8"),
        "legacy-preserve-me\n",
    );
    await assertManagementOnline(port);

    operationIds.push(operation(invokeCli(["stop", "--system"]).stdout, "stop migrated service"));
    await eventually(
        () => cliJson(["status", "--system", "--json"]),
        value => value.manager.state === "stopped" && value.manager.pid === null,
        "迁移后的 systemd 管理服务未稳定停止",
    );
    operationIds.push(
        operation(invokeCli(["uninstall", "--system"]).stdout, "uninstall migrated service"),
    );
    assertSystemServiceAbsent();
    assert.equal(
        fs.readFileSync(path.join(legacyData, "acceptance-user-data.txt"), "utf8"),
        "legacy-preserve-me\n",
    );
}

const port = await freePort();
const operationIds = [];
let completed = false;
let effectUnknown = false;
try {
    effectUnknown = true;
    await verifyLegacyMigration(port, operationIds);
    effectUnknown = false;

    effectUnknown = true;
    const installedOutput = invokeCli([
        "install",
        "--system",
        "--data-dir",
        dataDirectory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
    ]).stdout;
    effectUnknown = false;
    operationIds.push(operation(installedOutput, "install"));
    assert.equal(fs.existsSync(DEFINITION), true);
    assert.equal(fs.existsSync(METADATA), true);
    const installedMetadata = JSON.parse(fs.readFileSync(METADATA, "utf8"));
    assert.equal(installedMetadata.workspace, dataDirectory);
    assert.equal(installedMetadata.scope, "system");
    assert.equal(
        installedMetadata.workingDirectory.startsWith(
            `${STATE_DIRECTORY}/manager-artifacts/versions/`,
        ),
        true,
    );
    assert.equal(
        JSON.parse(
            fs.readFileSync(
                path.join(path.dirname(installedMetadata.binPath), "../package.json"),
                "utf8",
            ),
        ).version,
        manifest.host.version,
    );
    assert.equal(
        JSON.parse(
            fs.readFileSync(
                path.join(
                    installedMetadata.workingDirectory,
                    "node_modules/@onebots/core/package.json",
                ),
                "utf8",
            ),
        ).version,
        manifest.core.version,
    );
    const installed = cliJson(["status", "--system", "--json"]);
    assert.equal(installed.installation, "control");
    assert.equal(installed.manager.state, "stopped");
    assert.equal(installed.manager.enabled, true);
    assert.equal(installed.manager.pid, null);

    effectUnknown = true;
    const startedOutput = invokeCli(["start", "--system"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(startedOutput, "start"));
    const beforeRestart = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.os.gateway.actual === "running" &&
            value.os.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "系统级管理服务或网关未稳定运行",
    );
    assert.ok(Number.isInteger(beforeRestart.os.manager.pid) && beforeRestart.os.manager.pid > 0);
    assert.ok(beforeRestart.control.manager.id);
    assert.ok(beforeRestart.control.gateway.instance?.id);
    await assertManagementOnline(port);

    fs.writeFileSync(path.join(dataDirectory, "acceptance-user-data.txt"), "preserve-me\n", {
        mode: 0o600,
    });
    const preservedConfig = fs.readFileSync(path.join(dataDirectory, "config.yaml"));

    effectUnknown = true;
    const restartedOutput = invokeCli(["restart", "--system"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(restartedOutput, "restart"));
    const afterRestart = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.os.gateway.actual === "running" &&
            value.os.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "重启后系统级管理服务或网关未稳定运行",
    );
    assert.notEqual(afterRestart.os.manager.pid, beforeRestart.os.manager.pid);
    assert.notEqual(afterRestart.control.manager.id, beforeRestart.control.manager.id);
    assert.notEqual(
        afterRestart.control.gateway.instance?.id,
        beforeRestart.control.gateway.instance?.id,
    );
    await assertManagementOnline(port);

    effectUnknown = true;
    const stoppedOutput = invokeCli(["stop", "--system"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(stoppedOutput, "stop"));
    const stopped = await eventually(
        () => cliJson(["status", "--system", "--json"]),
        value => value.manager.state === "stopped" && value.manager.pid === null,
        "系统级管理服务未稳定停止",
    );
    assert.equal(stopped.manager.enabled, true);
    const gatewayState = fs.readFileSync(path.join(dataDirectory, ".control/gateway.json"));
    assert.equal(JSON.parse(gatewayState).desired, "running");

    effectUnknown = true;
    const uninstalledOutput = invokeCli(["uninstall", "--system"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(uninstalledOutput, "uninstall"));
    assertSystemServiceAbsent();
    const missing = cliJson(["status", "--system", "--json"], [1]);
    assert.equal(missing.installation, "missing");
    assert.equal(missing.diagnostic, "not-installed");
    assert.equal(
        fs.readFileSync(path.join(dataDirectory, "acceptance-user-data.txt"), "utf8"),
        "preserve-me\n",
    );
    assert.deepEqual(fs.readFileSync(path.join(dataDirectory, "config.yaml")), preservedConfig);
    assert.deepEqual(
        fs.readFileSync(path.join(dataDirectory, ".control/gateway.json")),
        gatewayState,
    );
    assert.equal(new Set(operationIds).size, operationIds.length, "生命周期操作 ID 必须互不相同");
    completed = true;
    process.stdout.write(
        "✓ 真实 systemd 系统级验收：旧服务迁移、异常退出冷启动、operation 持久性、新安装生命周期及卸载保留数据均通过\n",
    );
} finally {
    if (completed) fs.rmSync(temporary, { recursive: true, force: true });
    else
        process.stderr.write(
            `systemd 验收未完成${effectUnknown ? "且最近一次系统动作结果未知" : ""}；未重派或强制清理，请保留 runner 现场并检查 ${temporary}、${STATE_DIRECTORY} 与 ${DEFINITION}\n`,
        );
}
