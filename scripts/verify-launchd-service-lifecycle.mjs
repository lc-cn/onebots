/**
 * GitHub-hosted macOS runner 上的真实用户级 launchd 验收。
 *
 * OneBots 的 launchd label、plist 和服务状态目录都是固定身份。本脚本只在 Darwin、GitHub
 * 托管 runner 和显式 ONEBOTS_LAUNCHD_ACCEPTANCE=1 同时成立时运行，并在打包前证明这些
 * 身份不存在。任何已有安装、未知状态或路径替换都会使验收关闭失败，不覆盖用户数据。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
    installedManagerVersion,
    preparePreviousPatchArtifacts,
    verifyManagerPatchUpgrade,
} from "./manager-upgrade-acceptance-helpers.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LABEL = "com.onebots.onebots-gateway";
const UID = process.getuid?.();
const DOMAIN = `gui/${String(UID)}`;
const DEFINITION = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const SYSTEM_DEFINITION = path.join("/Library/LaunchDaemons", `${LABEL}.plist`);
const STATE_DIRECTORY = path.join(os.homedir(), "Library", "Application Support", "OneBots");
const METADATA = path.join(STATE_DIRECTORY, "service.json");

assert.equal(process.platform, "darwin", "真实 launchd 验收只允许在 macOS 运行");
assert.equal(Number.isSafeInteger(UID) && Number(UID) >= 0, true, "无法确认当前 macOS 用户");
assert.equal(process.env.CI, "true", "真实 launchd 验收只允许在 CI 运行");
assert.equal(process.env.GITHUB_ACTIONS, "true", "真实 launchd 验收只允许在 GitHub Actions 运行");
assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    "github-hosted",
    "真实 launchd 验收拒绝会保留系统副作用的 self-hosted runner",
);
assert.equal(
    process.env.ONEBOTS_LAUNCHD_ACCEPTANCE,
    "1",
    "必须显式设置 ONEBOTS_LAUNCHD_ACCEPTANCE=1",
);

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
    return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr,
    };
}

function launchdIdentityAbsent(domain, description) {
    const result = execute("/bin/launchctl", ["print", `${domain}/${LABEL}`], {
        statuses: [113],
        timeout: 5000,
        env: { ...process.env, LANG: "C" },
    });
    const expectedDomain = domain === "system" ? "system" : `user gui: ${String(UID)}`;
    const expected = `Bad request.\nCould not find service "${LABEL}" in domain for ${expectedDomain}`;
    assert.equal(
        result.stderr === expected || result.stderr === `${expected}\n`,
        true,
        `${description}的缺失结果无法确认`,
    );
}

function pathAbsent(filename) {
    try {
        fs.lstatSync(filename);
        return false;
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return true;
        throw error;
    }
}

function assertLaunchdAbsent() {
    launchdIdentityAbsent(DOMAIN, "固定用户级 launchd identity");
    launchdIdentityAbsent("system", "固定系统级 launchd identity");
    assert.equal(pathAbsent(DEFINITION), true, "固定 OneBots LaunchAgent plist 路径已存在");
    assert.equal(pathAbsent(SYSTEM_DEFINITION), true, "固定 OneBots LaunchDaemon plist 路径已存在");
    assert.equal(pathAbsent(METADATA), true, "固定 OneBots 服务元数据路径已存在");
}

// 任何打包、临时目录或安装动作之前先证明不会覆盖现有 OneBots 安装。
assertLaunchdAbsent();
assert.equal(pathAbsent(STATE_DIRECTORY), true, "固定 OneBots 服务状态目录路径已存在");
assert.equal(
    execute("pnpm", ["--version"]).stdout,
    "9.15.9",
    "真实 launchd 验收必须使用 pnpm 9.15.9",
);

const { LAUNCHD_LABEL } = await import(
    path.join(ROOT, "packages/onebots/lib/service-definition.js")
);
assert.equal(LAUNCHD_LABEL, LABEL, "验收固定 launchd label 与当前构建不一致");

const temporary = fs.realpathSync(fs.mkdtempSync("/tmp/ob-launchd-acceptance-"));
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

execute(process.execPath, ["scripts/pack-control-runtime.mjs", artifacts]);
execute("pnpm", ["pack", "--pack-destination", artifacts], {
    cwd: path.join(ROOT, "packages/web"),
});
const tarballs = fs
    .readdirSync(artifacts)
    .filter(name => name.endsWith(".tgz"))
    .map(name => path.join(artifacts, name));
assert.equal(tarballs.length, 3, "必须安装当前 core、web 和 onebots 三个打包工件");
const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, "manifest.json"), "utf8"));
const previous = preparePreviousPatchArtifacts({ temporary, artifacts, manifest, execute });
fs.writeFileSync(
    path.join(runtime, "package.json"),
    JSON.stringify({ name: "onebots-launchd-acceptance", private: true, version: "1.0.0" }),
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
        ...previous.installTarballs,
    ],
    { cwd: runtime, env: npmEnvironment },
);

const cli = path.join(runtime, "node_modules/.bin/onebots");
const cliStat = fs.lstatSync(cli);
assert.equal(cliStat.isFile() || cliStat.isSymbolicLink(), true);
assert.equal(
    JSON.parse(fs.readFileSync(path.join(runtime, "node_modules/onebots/package.json"), "utf8"))
        .version,
    previous.previousVersion,
);
assert.equal(
    JSON.parse(
        fs.readFileSync(path.join(runtime, "node_modules/@onebots/core/package.json"), "utf8"),
    ).version,
    manifest.core.version,
);
assert.equal(
    JSON.parse(
        fs.readFileSync(path.join(runtime, "node_modules/@onebots/web/package.json"), "utf8"),
    ).version,
    JSON.parse(fs.readFileSync(path.join(ROOT, "packages/web/package.json"), "utf8")).version,
);
const cliEnvironment = {
    ...npmEnvironment,
    LANG: "C",
    NO_COLOR: "1",
    ONEBOTS_RUNTIME_ARTIFACTS: previous.manifestFile,
};

const { renderLaunchdPlist } = await import(
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
    const firstLine = output.split(/\r?\n/u, 1)[0];
    assert.ok(
        match,
        `公开 CLI ${action} 未返回已完成操作 ID；首行=${JSON.stringify(firstLine.slice(0, 256))}`,
    );
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

function invokeMigration(args) {
    const result = invokeCli(args, [0, 1]);
    if (result.status === 0) return result.stdout;
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4096);
    throw new Error(
        `公开 CLI migrate 失败（exit ${String(result.status)}）：${text || "无输出"}；迁移记录=${JSON.stringify(migrationJournalStates())}`,
    );
}

function launchdState() {
    const output = execute("/bin/launchctl", ["print", `${DOMAIN}/${LABEL}`], {
        statuses: [0],
    }).stdout;
    const field = name => output.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "mu"))?.[1] ?? null;
    const pid = field("pid");
    const process =
        pid && /^[1-9][0-9]*$/u.test(pid)
            ? execute("/bin/ps", ["-o", "pid=,pgid=", "-p", pid], {
                  statuses: [0, 1],
              }).stdout
            : null;
    return { state: field("state"), pid, lastExitCode: field("last exit code"), process };
}

function launchdStrongIdentity() {
    const state = launchdState();
    assert.match(state.pid ?? "", /^[1-9][0-9]*$/u, "launchd 缺少稳定 PID");
    return {
        pid: state.pid,
        process: execute("/bin/ps", ["-o", "pid=,pgid=,lstart=", "-p", state.pid], {
            statuses: [0],
        }).stdout,
    };
}

function assertLaunchdIndependentProcessGroup() {
    const state = launchdState();
    const match = /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s*$/u.exec(state.process ?? "");
    assert.ok(match, `旧 launchd 服务缺少可解析的 PID/PGID 证据：${JSON.stringify(state)}`);
    assert.equal(match[1], state.pid, "launchctl PID 与 ps PID 不一致");
    assert.equal(match[2], match[1], "真实旧 launchd 服务没有独立进程组，当前安全契约拒绝迁移");
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
    for (let attempt = 0; attempt < 200; attempt++) {
        try {
            last = await read();
            if (await accept(last)) return last;
        } catch {
            // launchd 与 IPC 切换存在短暂窗口；只做有界只读重试，不重派生命周期动作。
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
    assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/control/status`)).status, 401);
}

async function verifyLegacyMigration(port, operationIds) {
    let legacyRuntime = path.join(temporary, "legacy-launchd-runtime");
    let legacyData = path.join(temporary, "legacy-launchd-data");
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
        scope: "user",
        configPath: legacyConfig,
        adapters: [],
        protocols: [],
        applications: [],
        nodePath: fs.realpathSync(process.execPath),
        binPath: legacyBin,
        workingDirectory: legacyRuntime,
    };
    fs.mkdirSync(path.dirname(DEFINITION), { recursive: true, mode: 0o700 });
    fs.mkdirSync(STATE_DIRECTORY, { recursive: true, mode: 0o700 });
    fs.writeFileSync(METADATA, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    fs.writeFileSync(
        DEFINITION,
        renderLaunchdPlist(
            legacy,
            path.join(STATE_DIRECTORY, "onebots.log"),
            path.join(STATE_DIRECTORY, "onebots-error.log"),
        ),
        { mode: 0o600 },
    );
    execute("/bin/launchctl", ["bootstrap", DOMAIN, DEFINITION]);
    try {
        await eventually(
            () => ({
                output: execute("/bin/launchctl", ["print", `${DOMAIN}/${LABEL}`]).stdout,
                ready: fs.existsSync(readyMarker),
            }),
            value => /\bstate\s*=\s*running\b/u.test(value.output) && value.ready,
            "旧 launchd 服务未稳定运行或未执行真实入口",
        );
    } catch (error) {
        throw new Error(`${error.message}；OS 状态：${JSON.stringify(launchdState())}`);
    }
    assertLaunchdIndependentProcessGroup();
    const legacyStatus = cliJson(["status", "--json"], [1]);
    assert.equal(legacyStatus.installation, "legacy");
    assert.equal(legacyStatus.diagnostic, "migration-required");

    const migrationOutput = invokeMigration([
        "migrate",
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
            os: cliJson(["status", "--json"]),
            control: cliJson(["control", "status", "--data-dir", legacyData]),
        }),
        value =>
            value.os.installation === "control" &&
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "旧 launchd 服务迁移后管理进程或网关未稳定运行",
    );
    assert.equal(
        JSON.parse(journalBeforeColdStart).id,
        migrationId,
        "迁移完成记录必须持久化公开 CLI 返回的 operation ID",
    );
    await assertManagementOnline(port);

    execute("/bin/kill", ["-KILL", String(beforeColdStart.os.manager.pid)]);
    const afterColdStart = await eventually(
        () => ({
            os: cliJson(["status", "--json"]),
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
        "launchd 未在管理进程异常退出后完成冷启动恢复",
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

    operationIds.push(operation(invokeCli(["stop"]).stdout, "stop migrated service"));
    await eventually(
        () => cliJson(["status", "--json"]),
        value => value.manager.state === "stopped" && value.manager.pid === null,
        "迁移后的 launchd 管理服务未稳定停止",
    );
    operationIds.push(operation(invokeCli(["uninstall"]).stdout, "uninstall migrated service"));
    assertLaunchdAbsent();
    assert.equal(
        fs.readFileSync(path.join(legacyData, "acceptance-user-data.txt"), "utf8"),
        "legacy-preserve-me\n",
    );
}

function ownedInstallation() {
    try {
        const metadata = JSON.parse(fs.readFileSync(METADATA, "utf8"));
        const definition = fs.lstatSync(DEFINITION);
        return (
            metadata.scope === "user" &&
            metadata.workspace === fs.realpathSync(dataDirectory) &&
            metadata.schemaVersion === 1 &&
            definition.isFile() &&
            !definition.isSymbolicLink()
        );
    } catch {
        return false;
    }
}

const port = await freePort();
const operationIds = [];
let completed = false;
let installedByThisRun = false;
let effectUnknown = false;
try {
    effectUnknown = true;
    await verifyLegacyMigration(port, operationIds);
    effectUnknown = false;

    effectUnknown = true;
    const installedOutput = invokeCli([
        "install",
        "--data-dir",
        dataDirectory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
    ]).stdout;
    effectUnknown = false;
    operationIds.push(operation(installedOutput, "install"));
    installedByThisRun = true;
    assert.equal(fs.existsSync(DEFINITION), true);
    assert.equal(fs.existsSync(METADATA), true);
    const stateIdentity = fs.lstatSync(STATE_DIRECTORY, { bigint: true });
    assert.equal(stateIdentity.isDirectory() && !stateIdentity.isSymbolicLink(), true);
    assert.equal(stateIdentity.uid, BigInt(UID));
    const installedMetadata = JSON.parse(fs.readFileSync(METADATA, "utf8"));
    assert.equal(installedMetadata.workspace, fs.realpathSync(dataDirectory));
    assert.equal(installedMetadata.scope, "user");
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
        previous.previousVersion,
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
    const installed = cliJson(["status", "--json"]);
    assert.equal(installed.installation, "control");
    assert.equal(installed.manager.state, "stopped");
    assert.equal(installed.manager.enabled, true);
    assert.equal(installed.manager.pid, null);

    effectUnknown = true;
    const startedOutput = invokeCli(["start"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(startedOutput, "start"));
    const beforeRestart = await eventually(
        () => ({
            os: cliJson(["status", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
            metadata: JSON.parse(fs.readFileSync(METADATA, "utf8")),
        }),
        value =>
            value.os.manager.state === "running" &&
            installedManagerVersion(value.metadata) === previous.previousVersion &&
            value.os.manager.ipc === "available" &&
            value.os.gateway.actual === "running" &&
            value.os.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "用户级管理服务或网关未稳定运行",
    );
    assert.ok(Number.isInteger(beforeRestart.os.manager.pid) && beforeRestart.os.manager.pid > 0);
    assert.ok(beforeRestart.control.manager.id);
    assert.ok(beforeRestart.control.gateway.instance?.id);
    await assertManagementOnline(port);

    const blankConfiguration = fs.readFileSync(path.join(dataDirectory, "config.yaml"), "utf8");
    assert.equal(
        blankConfiguration,
        "plugins:\n  adapters: []\n  protocols: []\n  applications: []\n",
        "空白安装不得预填平台账号、协议、框架或凭据",
    );
    fs.writeFileSync(path.join(dataDirectory, "acceptance-user-data.txt"), "preserve-me\n", {
        mode: 0o600,
    });
    const upgrade = await verifyManagerPatchUpgrade({
        cli,
        cliEnvironment,
        runtime,
        dataDirectory,
        stateDirectory: STATE_DIRECTORY,
        metadataFile: METADATA,
        manifest,
        artifacts,
        previousVersion: previous.previousVersion,
        installedMetadata,
        before: beforeRestart,
        invokeCli,
        cliJson,
        eventually,
        strongOsIdentity: launchdStrongIdentity,
        setEffectUnknown: value => {
            effectUnknown = value;
        },
    });
    operationIds.push(...upgrade.operationIds);
    const afterUpgrade = upgrade.upgraded;
    const bytesBeforeManagedRestart = new Map(
        ["config.yaml", ".control/gateway.json", ".control/auth.json"].map(file => [
            file,
            fs.existsSync(path.join(dataDirectory, file))
                ? fs.readFileSync(path.join(dataDirectory, file))
                : null,
        ]),
    );

    effectUnknown = true;
    const restartedOutput = invokeCli(["restart"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(restartedOutput, "restart"));
    const afterRestart = await eventually(
        () => ({
            os: cliJson(["status", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.enabled === true &&
            value.os.manager.ipc === "available" &&
            value.os.gateway.actual === "running" &&
            value.os.gateway.desired === "running" &&
            value.control.gateway.actual === "running",
        "重启后用户级管理服务或网关未稳定运行",
    );
    assert.notEqual(afterRestart.os.manager.pid, afterUpgrade.os.manager.pid);
    assert.notEqual(afterRestart.control.manager.id, afterUpgrade.control.manager.id);
    assert.notEqual(
        afterRestart.control.gateway.instance?.id,
        afterUpgrade.control.gateway.instance?.id,
    );
    assert.equal(
        installedManagerVersion(JSON.parse(fs.readFileSync(METADATA, "utf8"))),
        manifest.host.version,
    );
    assert.equal(
        JSON.parse(fs.readFileSync(METADATA, "utf8")).workingDirectory,
        afterUpgrade.metadata.workingDirectory,
        "launchd 重启必须继续使用升级后的不可变候选",
    );
    assert.equal(
        afterRestart.control.gateway.instance?.generationId,
        afterUpgrade.control.gateway.instance?.generationId,
    );
    assert.equal(
        afterRestart.control.gateway.instance?.configRevision,
        afterUpgrade.control.gateway.instance?.configRevision,
    );
    for (const [file, bytes] of bytesBeforeManagedRestart) {
        const filename = path.join(dataDirectory, file);
        if (bytes === null) assert.equal(fs.existsSync(filename), false, `${file} 不得被创建`);
        else assert.deepEqual(fs.readFileSync(filename), bytes);
    }
    await assertManagementOnline(port);

    effectUnknown = true;
    const stoppedOutput = invokeCli(["stop"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(stoppedOutput, "stop"));
    const stopped = await eventually(
        () => cliJson(["status", "--json"]),
        value => value.manager.state === "stopped" && value.manager.pid === null,
        "用户级管理服务未稳定停止",
    );
    assert.equal(stopped.manager.enabled, true);
    const gatewayState = fs.readFileSync(path.join(dataDirectory, ".control/gateway.json"));
    assert.equal(JSON.parse(gatewayState).desired, "running");

    effectUnknown = true;
    const uninstalledOutput = invokeCli(["uninstall"]).stdout;
    effectUnknown = false;
    operationIds.push(operation(uninstalledOutput, "uninstall"));
    installedByThisRun = false;
    assertLaunchdAbsent();
    const missing = cliJson(["status", "--json"], [1]);
    assert.equal(missing.installation, "missing");
    assert.equal(missing.diagnostic, "not-installed");
    assert.equal(
        fs.readFileSync(path.join(dataDirectory, "acceptance-user-data.txt"), "utf8"),
        "preserve-me\n",
    );
    assert.equal(
        fs.readFileSync(path.join(dataDirectory, "config.yaml"), "utf8"),
        blankConfiguration,
    );
    assert.deepEqual(
        fs.readFileSync(path.join(dataDirectory, ".control/gateway.json")),
        gatewayState,
    );
    assert.equal(new Set(operationIds).size, operationIds.length, "生命周期操作 ID 必须互不相同");
    completed = true;
    process.stdout.write(
        "✓ 真实 launchd 用户级验收：旧服务迁移、异常退出冷启动、旧 patch 升级故障回退与重启恢复、operation 幂等、空白新安装生命周期及卸载保留数据均通过\n",
    );
} finally {
    // 仅在最近一次外部效果结果已知且元数据仍绑定本次临时工作区时尝试公开卸载。
    if (!completed && installedByThisRun && !effectUnknown && ownedInstallation()) {
        try {
            invokeCli(["uninstall"]);
            installedByThisRun = false;
        } catch {
            /* 保留身份与工作区供对账，不能用 launchctl 或删文件绕过恢复门禁。 */
        }
    }
    let serviceAbsent = false;
    try {
        assertLaunchdAbsent();
        serviceAbsent = true;
    } catch {
        serviceAbsent = false;
    }
    // 固定状态目录由系统服务事务管理。托管 runner 会在任务后销毁，不在验收脚本中递归删除。
    if (serviceAbsent) fs.rmSync(temporary, { recursive: true, force: true });
    else
        process.stderr.write(
            `launchd 验收未完成${effectUnknown ? "且最近一次系统动作结果未知" : ""}；未强制重派或删除服务，请检查 ${temporary}、${STATE_DIRECTORY} 与 ${DEFINITION}\n`,
        );
}
