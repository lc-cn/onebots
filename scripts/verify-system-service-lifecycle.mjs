/**
 * GitHub-hosted Ubuntu runner 上的真实 systemd 验收。
 *
 * 固定系统服务名意味着本脚本不能与任何既有 OneBots 安装共享主机。只有 root、GitHub Actions
 * 和显式 ONEBOTS_SYSTEMD_ACCEPTANCE=1 同时成立时才允许执行；任何未知结果都保留现场，不重派动作。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
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
const previousArtifacts = path.join(temporary, "previous-artifacts");
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
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/u.exec(manifest.host.version);
assert.ok(versionMatch && Number(versionMatch[3]) > 0, "验收目标必须能构造前一个 patch 版本");
const previousVersion = `${versionMatch[1]}.${versionMatch[2]}.${Number(versionMatch[3]) - 1}`;
fs.mkdirSync(previousArtifacts, { mode: 0o700 });
const previousStaging = path.join(temporary, "previous-package");
fs.mkdirSync(previousStaging, { mode: 0o700 });
execute("tar", ["-xzf", path.join(artifacts, manifest.host.file), "-C", previousStaging]);
const previousPackage = path.join(previousStaging, "package/package.json");
const previousPackageJson = JSON.parse(fs.readFileSync(previousPackage, "utf8"));
previousPackageJson.version = previousVersion;
fs.writeFileSync(previousPackage, `${JSON.stringify(previousPackageJson, null, 2)}\n`, {
    mode: 0o600,
});
const previousHostFile = `onebots-${previousVersion}.tgz`;
execute("tar", [
    "-czf",
    path.join(previousArtifacts, previousHostFile),
    "-C",
    previousStaging,
    "package",
]);
for (const entry of [manifest.core, ...manifest.extensions])
    fs.copyFileSync(path.join(artifacts, entry.file), path.join(previousArtifacts, entry.file));
const previousManifest = {
    ...manifest,
    host: {
        ...manifest.host,
        version: previousVersion,
        file: previousHostFile,
        sha256: createHash("sha256")
            .update(fs.readFileSync(path.join(previousArtifacts, previousHostFile)))
            .digest("hex"),
    },
};
fs.writeFileSync(
    path.join(previousArtifacts, "manifest.json"),
    `${JSON.stringify(previousManifest, null, 2)}\n`,
    { mode: 0o600 },
);
const installTarballs = tarballs.map(file =>
    path.basename(file) === manifest.host.file
        ? path.join(previousArtifacts, previousHostFile)
        : file,
);
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
        ...installTarballs,
    ],
    { cwd: runtime, env: npmEnvironment, statuses: [0] },
);

const cli = path.join(runtime, "node_modules/.bin/onebots");
const cliStat = fs.lstatSync(cli);
assert.equal(cliStat.isFile() || cliStat.isSymbolicLink(), true);
assert.equal(
    JSON.parse(fs.readFileSync(path.join(runtime, "node_modules/onebots/package.json"), "utf8"))
        .version,
    previousVersion,
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
    ONEBOTS_RUNTIME_ARTIFACTS: path.join(previousArtifacts, "manifest.json"),
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

function spawnCli(args) {
    const child = spawn(cli, args, {
        cwd: runtime,
        env: cliEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (status, signal) =>
            resolve({
                status,
                signal,
                stdout: Buffer.concat(stdout).toString("utf8").trim(),
                stderr: Buffer.concat(stderr).toString("utf8").trim(),
            }),
        );
    });
    return { child, closed };
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

function managerUpgradeOperation(output) {
    const match = /^管理程序升级操作 ID：([A-Za-z0-9_-]{1,100})$/mu.exec(output);
    assert.ok(match, "公开 update --manager 未返回持久升级操作 ID");
    assert.match(output, new RegExp(`管理程序已切换到 ${manifest.host.version}`, "u"));
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
    let copiedHash = "unavailable";
    let copiedNativeValidation = "unavailable";
    let copiedExecution = "unavailable";
    try {
        const { assertSystemNativeDependencies } = await import(
            path.join(runtime, "node_modules/onebots/lib/service-migration-native-dependencies.js")
        );
        const { hashRuntimeFile } = await import(
            path.join(runtime, "node_modules/onebots/lib/service-migration-runtime-tree-scan.js")
        );
        const source = fs.realpathSync(process.execPath);
        await assertSystemNativeDependencies(source);
        nativeValidation = "passed";
        const copied = path.join(temporary, "node-capture-diagnostic");
        fs.copyFileSync(source, copied, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(copied, fs.statSync(source).mode & 0o777);
        copiedHash =
            JSON.stringify(await hashRuntimeFile(source)) ===
            JSON.stringify(await hashRuntimeFile(copied))
                ? "passed"
                : "failed";
        try {
            await assertSystemNativeDependencies(copied);
            copiedNativeValidation = "passed";
        } catch {
            copiedNativeValidation = "failed";
        }
        const probe = execute(
            copied,
            [
                "--no-addons",
                "-e",
                "const crypto=require('node:crypto');require('node:tls').createSecureContext();if(crypto.createHash('sha256').update('onebots').digest('hex').length!==64)process.exit(1);process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}))",
            ],
            { statuses: [0], env: { PATH: "/usr/bin:/bin" }, cwd: path.dirname(copied) },
        );
        const identity = JSON.parse(probe.stdout);
        copiedExecution =
            /^v\d+\.\d+\.\d+$/u.test(identity.version) &&
            identity.platform === process.platform &&
            identity.arch === process.arch
                ? "passed"
                : "failed";
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
    return {
        preload,
        nativeValidation,
        copiedHash,
        copiedNativeValidation,
        copiedExecution,
        needed,
        nonSystemCacheTargets,
    };
}

async function invokeMigration(args) {
    const result = invokeCli(args, [0, 1]);
    if (result.status === 0) return result.stdout;
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 4096);
    throw new Error(
        `公开 CLI migrate 失败（exit ${String(result.status)}）：${text || "无输出"}；迁移记录=${JSON.stringify(migrationJournalStates())}；捕获阶段=${JSON.stringify(migrationCaptureState())}；Node捕获=${JSON.stringify(await linuxNodeCaptureState())}`,
    );
}

function spawnMigration(args) {
    const child = spawn(cli, args, {
        cwd: runtime,
        env: cliEnvironment,
        stdio: "ignore",
    });
    const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (status, signal) => resolve({ status, signal }));
    });
    return { child, closed };
}

function singleMigrationJournal() {
    const directory = path.join(STATE_DIRECTORY, "migrations");
    if (!fs.existsSync(directory)) return null;
    const names = fs.readdirSync(directory).filter(name => name.endsWith(".journal.json"));
    if (names.length !== 1) return null;
    const name = names[0];
    const id = name.slice(0, -".journal.json".length);
    return {
        id,
        file: path.join(directory, name),
        record: JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")),
    };
}

function newUpgradeJournal(previousNames) {
    const directory = path.join(STATE_DIRECTORY, "manager-operations");
    if (!fs.existsSync(directory)) return null;
    const names = fs
        .readdirSync(directory)
        .filter(name => name.endsWith(".json") && !previousNames.has(name));
    if (names.length !== 1) return null;
    const file = path.join(directory, names[0]);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record.action === "upgrade" ? { file, record } : null;
}

async function obstructControlSocketWhenReleased(workspace, childResult) {
    const socket = path.join(workspace, ".control/control.sock");
    const deadline = Date.now() + 120_000;
    for (;;) {
        try {
            fs.mkdirSync(socket, { mode: 0o700 });
            return socket;
        } catch (error) {
            if (error?.code !== "EEXIST" || Date.now() >= deadline) throw error;
            const exited = await Promise.race([
                childResult.then(result => ({ result })),
                new Promise(resolve => setTimeout(() => resolve(null), 5)),
            ]);
            if (exited)
                throw new Error(`升级 CLI 在旧控制 socket 释放前退出：${exited.result.status}`);
        }
    }
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

async function eventually(read, accept, message, attempts = 100) {
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
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
    const legacyNodeDirectory = path.join(temporary, "legacy-systemd-node");
    const legacyCore = path.join(legacyRuntime, "node_modules/@onebots/core");
    fs.mkdirSync(legacyCore, { recursive: true, mode: 0o700 });
    fs.mkdirSync(legacyData, { recursive: true, mode: 0o700 });
    fs.mkdirSync(legacyNodeDirectory, { mode: 0o700 });
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
    const stoppingMarker = path.join(legacyData, "legacy-stopping");
    fs.writeFileSync(
        legacyBin,
        `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready\\n", { mode: 0o600 }); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stoppingMarker)}, "stopping\\n", { mode: 0o600 }); setTimeout(() => process.exit(0), 15_000); }); setInterval(() => {}, 60_000);\n`,
        { mode: 0o600 },
    );
    legacyBin = fs.realpathSync(legacyBin);
    // setup-node 的共享 toolcache 元数据不是旧系统服务的稳定工件契约；验收先建立
    // 私有、不可被组或其他用户改写的 Node，随后由生产迁移再次复制并验证它。
    let legacyNode = path.join(legacyNodeDirectory, "node");
    fs.copyFileSync(process.execPath, legacyNode, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(legacyNode, 0o700);
    legacyNode = fs.realpathSync(legacyNode);
    const legacyNodeStat = fs.lstatSync(legacyNode);
    assert.equal(legacyNodeStat.isFile(), true);
    assert.equal(legacyNodeStat.isSymbolicLink(), false);
    assert.equal(legacyNodeStat.nlink, 1);
    assert.equal(legacyNodeStat.mode & 0o7777, 0o700);
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
        nodePath: legacyNode,
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

    const originalDefinition = fs.readFileSync(DEFINITION);
    const originalMetadata = fs.readFileSync(METADATA);
    const originalConfiguration = fs.readFileSync(legacyConfig);
    const originalService = execute("systemctl", [
        "show",
        SERVICE,
        "--property=MainPID",
        "--property=InvocationID",
    ]).stdout;
    const originalProcessId = Number(/^MainPID=(\d+)$/mu.exec(originalService)?.[1]);
    const originalIdentity = /^InvocationID=([0-9a-f]{32})$/mu.exec(originalService)?.[1];
    assert.ok(Number.isInteger(originalProcessId) && originalProcessId > 0);
    assert.ok(originalIdentity);
    const interrupted = spawnMigration([
        "migrate",
        "--system",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
    ]);
    const stopping = await Promise.race([
        eventually(
            () => singleMigrationJournal(),
            value =>
                value?.record.phase === "stopping-old" &&
                value.record.status === "running" &&
                fs.existsSync(stoppingMarker),
            "未能在真实 systemd 停服窗口稳定观察到 stopping-old",
            2400,
        ),
        interrupted.closed.then(result => {
            throw new Error(
                `迁移 CLI 在故障注入窗口前退出（exit ${String(result.status)}，signal ${String(result.signal)}）`,
            );
        }),
    ]);
    assert.ok(stopping);
    const stoppingJournal = fs.readFileSync(stopping.file);
    assert.equal(interrupted.child.kill("SIGKILL"), true, "无法中断迁移 CLI");
    assert.deepEqual(await interrupted.closed, { status: null, signal: "SIGKILL" });
    operationIds.push(stopping.id);
    assert.deepEqual(
        fs.readFileSync(stopping.file),
        stoppingJournal,
        "迁移 CLI 的 SIGKILL 不得伪造中断终态",
    );
    const stoppedState = await eventually(
        () =>
            execute("systemctl", [
                "show",
                SERVICE,
                "--property=ActiveState",
                "--property=SubState",
                "--property=UnitFileState",
                "--property=MainPID",
            ]).stdout,
        value =>
            value.includes("ActiveState=inactive") &&
            value.includes("SubState=dead") &&
            value.includes("UnitFileState=disabled") &&
            value.includes("MainPID=0"),
        "迁移 CLI 中断后旧 systemd 服务未完成已提交的停止动作",
        400,
    );
    assert.deepEqual(fs.readFileSync(DEFINITION), originalDefinition);
    assert.deepEqual(fs.readFileSync(METADATA), originalMetadata);
    assert.deepEqual(fs.readFileSync(legacyConfig), originalConfiguration);

    const journalsBeforeGateChecks = fs.readdirSync(path.join(STATE_DIRECTORY, "migrations"));
    assert.equal(
        invokeCli(["migrate", "--system", "--host", "127.0.0.1", "--port", String(port)], [1])
            .status,
        1,
        "未恢复的迁移不得再次派发",
    );
    assert.equal(
        invokeCli(
            [
                "install",
                "--system",
                "--data-dir",
                legacyData,
                "--host",
                "127.0.0.1",
                "--port",
                String(port),
            ],
            [1],
        ).status,
        1,
        "未恢复的迁移不得被新安装绕过",
    );
    assert.deepEqual(
        fs.readdirSync(path.join(STATE_DIRECTORY, "migrations")),
        journalsBeforeGateChecks,
        "恢复门禁检查不得创建新的迁移 operation",
    );
    assert.deepEqual(fs.readFileSync(DEFINITION), originalDefinition);
    assert.deepEqual(fs.readFileSync(METADATA), originalMetadata);
    assert.deepEqual(fs.readFileSync(legacyConfig), originalConfiguration);
    assert.equal(
        execute("systemctl", [
            "show",
            SERVICE,
            "--property=ActiveState",
            "--property=SubState",
            "--property=UnitFileState",
            "--property=MainPID",
        ]).stdout,
        stoppedState,
        "恢复门禁检查不得重派 systemd 动作",
    );
    const interruptedRecord = JSON.parse(fs.readFileSync(stopping.file, "utf8"));
    assert.deepEqual(
        {
            phase: interruptedRecord.phase,
            status: interruptedRecord.status,
            recoveryRequired: interruptedRecord.recoveryRequired,
        },
        { phase: "stopping-old", status: "interrupted", recoveryRequired: true },
    );

    fs.rmSync(readyMarker);
    const recoveredOutput = invokeCli([
        "recover",
        "--operation",
        stopping.id,
        "--rollback-migration",
        "--system",
    ]).stdout;
    assert.match(recoveredOutput, new RegExp(`操作 ${stopping.id}：已恢复保留的旧服务`, "u"));
    const recoveredState = await eventually(
        () =>
            execute("systemctl", [
                "show",
                SERVICE,
                "--property=ActiveState",
                "--property=SubState",
                "--property=UnitFileState",
                "--property=MainPID",
                "--property=InvocationID",
            ]).stdout,
        value => {
            const processId = Number(/^MainPID=(\d+)$/mu.exec(value)?.[1]);
            const identity = /^InvocationID=([0-9a-f]{32})$/mu.exec(value)?.[1];
            return (
                value.includes("ActiveState=active") &&
                value.includes("SubState=running") &&
                value.includes("UnitFileState=enabled") &&
                processId > 0 &&
                processId !== originalProcessId &&
                identity !== undefined &&
                identity !== originalIdentity &&
                fs.existsSync(readyMarker)
            );
        },
        "公开恢复命令未通过真实 systemd 恢复旧服务",
    );
    const recoveredProcessId = Number(/^MainPID=(\d+)$/mu.exec(recoveredState)?.[1]);
    const recoveredIdentity = /^InvocationID=([0-9a-f]{32})$/mu.exec(recoveredState)?.[1];
    assert.ok(Number.isInteger(recoveredProcessId) && recoveredProcessId > 0);
    assert.ok(recoveredIdentity);
    const recoveredJournal = fs.readFileSync(stopping.file);
    const recoveredRecord = JSON.parse(recoveredJournal);
    assert.deepEqual(
        {
            id: recoveredRecord.id,
            schemaVersion: recoveredRecord.schemaVersion,
            phase: recoveredRecord.phase,
            status: recoveredRecord.status,
            recoveryRequired: recoveredRecord.recoveryRequired,
            rolledBack: recoveredRecord.rolledBack,
            rollbackOrigin: recoveredRecord.rollbackOrigin,
        },
        {
            id: stopping.id,
            schemaVersion: 1,
            phase: "completed",
            status: "failed",
            recoveryRequired: false,
            rolledBack: true,
            rollbackOrigin: undefined,
        },
        "目标写入前的 v1 迁移记录必须保持兼容并进入已确认回退终态",
    );
    const recoveredDefinition = fs.readFileSync(DEFINITION);
    const recoveredMetadata = fs.readFileSync(METADATA);
    const repeatedRecovery = invokeCli([
        "recover",
        "--operation",
        stopping.id,
        "--rollback-migration",
        "--system",
    ]).stdout;
    assert.match(repeatedRecovery, new RegExp(`操作 ${stopping.id}：已恢复保留的旧服务`, "u"));
    assert.deepEqual(fs.readFileSync(stopping.file), recoveredJournal);
    assert.deepEqual(fs.readFileSync(DEFINITION), recoveredDefinition);
    assert.deepEqual(fs.readFileSync(METADATA), recoveredMetadata);
    const repeatedState = execute("systemctl", [
        "show",
        SERVICE,
        "--property=MainPID",
        "--property=InvocationID",
    ]).stdout;
    assert.deepEqual(
        {
            processId: Number(/^MainPID=(\d+)$/mu.exec(repeatedState)?.[1]),
            identity: /^InvocationID=([0-9a-f]{32})$/mu.exec(repeatedState)?.[1],
        },
        { processId: recoveredProcessId, identity: recoveredIdentity },
        "重复 recover 不得重载或重启旧服务",
    );
    assert.equal(
        fs.readFileSync(path.join(legacyData, "acceptance-user-data.txt"), "utf8"),
        "legacy-preserve-me\n",
    );
    assert.deepEqual(fs.readFileSync(legacyConfig), originalConfiguration);

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
        previousVersion,
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
    const preservedGatewayIntent = fs.readFileSync(
        path.join(dataDirectory, ".control/gateway.json"),
    );
    const authenticationFile = path.join(dataDirectory, ".control/auth.json");
    const preservedAuthentication = fs.existsSync(authenticationFile)
        ? fs.readFileSync(authenticationFile)
        : null;
    const assertAuthenticationPreserved = () =>
        assert.deepEqual(
            fs.existsSync(authenticationFile) ? fs.readFileSync(authenticationFile) : null,
            preservedAuthentication,
            "管理程序升级不得创建、删除或修改认证状态",
        );

    const managerOperationsDirectory = path.join(STATE_DIRECTORY, "manager-operations");
    const operationsBeforeFailedUpgrade = new Set(fs.readdirSync(managerOperationsDirectory));
    const failedUpgrade = spawnCli([
        "update",
        "--manager",
        "--system",
        "--yes",
        "--version",
        manifest.host.version,
        "--artifacts",
        path.join(artifacts, "manifest.json"),
    ]);
    effectUnknown = true;
    const socketObstacle = await obstructControlSocketWhenReleased(
        dataDirectory,
        failedUpgrade.closed,
    );
    const failedUpgradeResult = await failedUpgrade.closed;
    effectUnknown = false;
    assert.equal(failedUpgradeResult.status, 1, "控制 socket 障碍必须让候选启动失败");
    assert.equal(failedUpgradeResult.signal, null);
    assert.equal(
        failedUpgradeResult.stdout.includes("管理程序已切换"),
        false,
        "失败候选不得输出升级成功",
    );
    const interruptedUpgrade = await eventually(
        () => newUpgradeJournal(operationsBeforeFailedUpgrade),
        value =>
            value?.record.action === "upgrade" &&
            value.record.phase === "starting" &&
            value.record.status === "interrupted" &&
            value.record.recoveryRequired === true,
        "真实候选启动失败未保留可回退的 starting 阶段",
    );
    const failedUpgradeId = interruptedUpgrade.record.id;
    operationIds.push(failedUpgradeId);
    assert.deepEqual(fs.readFileSync(path.join(dataDirectory, "config.yaml")), preservedConfig);
    assert.deepEqual(
        fs.readFileSync(path.join(dataDirectory, ".control/gateway.json")),
        preservedGatewayIntent,
    );
    assertAuthenticationPreserved();
    fs.rmdirSync(socketObstacle);

    effectUnknown = true;
    const rollbackOutput = invokeCli([
        "recover",
        "--operation",
        failedUpgradeId,
        "--rollback-upgrade",
        "--system",
    ]).stdout;
    effectUnknown = false;
    assert.match(rollbackOutput, new RegExp(`操作 ${failedUpgradeId}：已恢复升级前`, "u"));
    const afterRollback = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
            metadata: JSON.parse(fs.readFileSync(METADATA, "utf8")),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.version === previousVersion &&
            value.os.manager.ipc === "available" &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running" &&
            value.metadata.workingDirectory === installedMetadata.workingDirectory,
        "公开升级回退未通过真实 systemd 恢复旧管理候选及网关意图",
        600,
    );
    assert.notEqual(afterRollback.os.manager.pid, beforeRestart.os.manager.pid);
    assert.notEqual(afterRollback.control.manager.id, beforeRestart.control.manager.id);
    assert.deepEqual(fs.readFileSync(path.join(dataDirectory, "config.yaml")), preservedConfig);
    assert.deepEqual(
        fs.readFileSync(path.join(dataDirectory, ".control/gateway.json")),
        preservedGatewayIntent,
    );
    assertAuthenticationPreserved();
    const rolledBackJournal = fs.readFileSync(interruptedUpgrade.file);
    const rolledBackRecord = JSON.parse(rolledBackJournal);
    assert.deepEqual(
        {
            phase: rolledBackRecord.phase,
            status: rolledBackRecord.status,
            recoveryRequired: rolledBackRecord.recoveryRequired,
        },
        { phase: "completed", status: "failed", recoveryRequired: false },
    );
    const identityAfterRollback = execute("systemctl", [
        "show",
        SERVICE,
        "--property=MainPID",
        "--property=InvocationID",
    ]).stdout;
    assert.match(
        invokeCli(["recover", "--operation", failedUpgradeId, "--rollback-upgrade", "--system"])
            .stdout,
        new RegExp(`操作 ${failedUpgradeId}：已恢复升级前`, "u"),
    );
    assert.deepEqual(fs.readFileSync(interruptedUpgrade.file), rolledBackJournal);
    assert.equal(
        execute("systemctl", ["show", SERVICE, "--property=MainPID", "--property=InvocationID"])
            .stdout,
        identityAfterRollback,
        "重复升级回退不得再次停止或启动旧服务",
    );

    effectUnknown = true;
    const upgradedOutput = invokeCli([
        "update",
        "--manager",
        "--system",
        "--yes",
        "--version",
        manifest.host.version,
        "--artifacts",
        path.join(artifacts, "manifest.json"),
    ]).stdout;
    effectUnknown = false;
    const upgradeId = managerUpgradeOperation(upgradedOutput);
    operationIds.push(upgradeId);
    const afterUpgrade = await eventually(
        () => ({
            os: cliJson(["status", "--system", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
            metadata: JSON.parse(fs.readFileSync(METADATA, "utf8")),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.os.manager.version === manifest.host.version &&
            value.control.gateway.actual === "running" &&
            value.control.gateway.desired === "running" &&
            value.metadata.workingDirectory !== installedMetadata.workingDirectory,
        "公开管理程序升级未通过真实 systemd 切换到新不可变候选",
        600,
    );
    assert.notEqual(afterUpgrade.os.manager.pid, beforeRestart.os.manager.pid);
    assert.notEqual(afterUpgrade.control.manager.id, beforeRestart.control.manager.id);
    assert.notEqual(
        afterUpgrade.control.gateway.instance?.id,
        beforeRestart.control.gateway.instance?.id,
    );
    assert.equal(
        afterUpgrade.control.gateway.instance?.generationId,
        beforeRestart.control.gateway.instance?.generationId,
        "管理程序升级不得改变活动网关 generation",
    );
    assert.equal(
        afterUpgrade.control.gateway.instance?.configRevision,
        beforeRestart.control.gateway.instance?.configRevision,
        "管理程序升级不得改变网关配置快照",
    );
    assert.deepEqual(fs.readFileSync(path.join(dataDirectory, "config.yaml")), preservedConfig);
    assert.deepEqual(
        fs.readFileSync(path.join(dataDirectory, ".control/gateway.json")),
        preservedGatewayIntent,
    );
    assertAuthenticationPreserved();
    assert.equal(
        JSON.parse(
            fs.readFileSync(
                path.join(
                    afterUpgrade.metadata.workingDirectory,
                    "node_modules/onebots/package.json",
                ),
                "utf8",
            ),
        ).version,
        manifest.host.version,
    );
    const upgradeJournal = path.join(STATE_DIRECTORY, "manager-operations", `${upgradeId}.json`);
    const completedUpgradeJournal = fs.readFileSync(upgradeJournal);
    assert.deepEqual(JSON.parse(completedUpgradeJournal), {
        ...JSON.parse(completedUpgradeJournal),
        action: "upgrade",
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
    });
    const systemdIdentityAfterUpgrade = execute("systemctl", [
        "show",
        SERVICE,
        "--property=MainPID",
        "--property=InvocationID",
    ]).stdout;
    const repeatedUpgradeRecovery = invokeCli([
        "recover",
        "--operation",
        upgradeId,
        "--system",
    ]).stdout;
    assert.match(repeatedUpgradeRecovery, new RegExp(`操作 ${upgradeId}：succeeded`, "u"));
    assert.deepEqual(fs.readFileSync(upgradeJournal), completedUpgradeJournal);
    assert.equal(
        execute("systemctl", ["show", SERVICE, "--property=MainPID", "--property=InvocationID"])
            .stdout,
        systemdIdentityAfterUpgrade,
        "重复升级对账不得重启服务或重复派发切换",
    );

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
    assert.notEqual(afterRestart.os.manager.pid, afterUpgrade.os.manager.pid);
    assert.notEqual(afterRestart.control.manager.id, afterUpgrade.control.manager.id);
    assert.notEqual(
        afterRestart.control.gateway.instance?.id,
        afterUpgrade.control.gateway.instance?.id,
    );
    assert.equal(afterRestart.os.manager.version, manifest.host.version);
    assert.equal(
        JSON.parse(fs.readFileSync(METADATA, "utf8")).workingDirectory,
        afterUpgrade.metadata.workingDirectory,
        "systemd 重启必须继续使用升级后的不可变候选",
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
        "✓ 真实 systemd 系统级验收：旧服务迁移中断冷回退、完成迁移后的异常退出冷启动、旧 patch 到当前 patch 的管理程序不可变升级与重启恢复、operation 幂等对账、新安装生命周期及卸载保留数据均通过\n",
    );
} finally {
    if (completed) fs.rmSync(temporary, { recursive: true, force: true });
    else
        process.stderr.write(
            `systemd 验收未完成${effectUnknown ? "且最近一次系统动作结果未知" : ""}；未重派或强制清理，请保留 runner 现场并检查 ${temporary}、${STATE_DIRECTORY} 与 ${DEFINITION}\n`,
        );
}
