import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { packControlRuntime } from "./pack-control-runtime.mjs";

if (process.platform !== "win32" || process.env.ONEBOTS_WINDOWS_ACCEPTANCE !== "1")
    throw new Error("Windows 生命周期验收只能在显式启用的 windows-latest 主机运行");

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-lifecycle-"));
const artifacts = path.join(temporary, "artifacts");
const runtime = path.join(temporary, "runtime");
const workspace = path.join(temporary, "workspace");
const marker = path.join(workspace, "preserved-user-data.txt");
const stateDirectory = path.join(process.env.ProgramData ?? "C:\\ProgramData", "OneBots");
const definitionPath = path.join(stateDirectory, "onebots-service.xml");
const metadataPath = path.join(stateDirectory, "service.json");
const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
            server.close();
            reject(new Error("无法分配 Windows 验收端口"));
            return;
        }
        server.close(error => (error ? reject(error) : resolve(address.port)));
    });
});
const origin = `http://127.0.0.1:${port}`;
const service = "onebots-gateway";
let installed = false;
let installedDefinition;
let installedScmPathName;

const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
].find(candidate => candidate && fs.existsSync(candidate));
if (!npmCli) throw new Error("无法定位 npm CLI JavaScript 入口");

function run(file, args, options = {}) {
    return execFileSync(file, args, {
        cwd: options.cwd ?? runtime,
        env: options.env ?? process.env,
        encoding: "utf8",
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
        timeout: options.timeout ?? 15 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
    }).trim();
}

function powershell(script) {
    return run(
        "powershell.exe",
        [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
        ],
        { cwd: root },
    );
}

async function eventually(probe, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    let error;
    while (Date.now() < deadline) {
        try {
            return await probe();
        } catch (current) {
            error = current;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    throw error ?? new Error("等待 Windows 状态超时");
}

async function request(route, init = {}) {
    const response = await fetch(`${origin}${route}`, {
        ...init,
        signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${route}: ${response.status}`);
    return body;
}

function cli(bin, args, input = "", env = process.env) {
    const result = spawnSync(process.execPath, [bin, ...args], {
        cwd: runtime,
        env,
        input,
        encoding: "utf8",
        timeout: 15 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0)
        throw new Error(`onebots ${args.join(" ")} 退出 ${result.status}: ${result.stderr}`);
    return result.stdout.trim();
}

function servicePresence() {
    return powershell(
        `$s=Get-CimInstance Win32_Service -Filter \"Name='${service}'\";if($null -eq $s){'absent'}else{$s|Select-Object Name,State,StartMode,ProcessId,PathName|ConvertTo-Json -Compress}`,
    );
}

function assertBlankMachineState() {
    assert.equal(servicePresence(), "absent", "固定 SCM 服务已存在，拒绝覆盖 runner 现场");
    assert.equal(fs.existsSync(stateDirectory), false, "固定服务状态目录已存在，拒绝覆盖");
    assert.equal(fs.existsSync(definitionPath), false);
    assert.equal(fs.existsSync(metadataPath), false);
}

function stillOwnsInstallation() {
    if (!installedDefinition || !fs.existsSync(definitionPath) || !fs.existsSync(metadataPath))
        return false;
    try {
        const observed = JSON.parse(servicePresence());
        return (
            fs.readFileSync(definitionPath).equals(installedDefinition) &&
            observed.Name === service &&
            observed.PathName === installedScmPathName
        );
    } catch {
        return false;
    }
}

try {
    run("net.exe", ["session"], { cwd: root });
    assertBlankMachineState();
    await packControlRuntime({ repositoryRoot: root, outputDirectory: artifacts });
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ private: true }));
    const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, "manifest.json"), "utf8"));
    run(
        process.execPath,
        [
            npmCli,
            "install",
            "--ignore-scripts",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            path.join(artifacts, manifest.core.file),
            path.join(artifacts, manifest.host.file),
        ],
        { cwd: runtime },
    );
    const bin = path.join(runtime, "node_modules", "onebots", "lib", "bin.js");
    const host = path.join(
        runtime,
        "node_modules",
        "onebots",
        "lib",
        "native",
        `win32-${process.arch}`,
        "onebots-windows-host.exe",
    );
    assert.ok(fs.statSync(host).size > 100_000);
    const env = {
        ...process.env,
        ONEBOTS_RUNTIME_ARTIFACTS: path.join(artifacts, "manifest.json"),
    };
    assert.match(
        cli(bin, ["install", "--system", "--data-dir", workspace, "--port", String(port)], "", env),
        /succeeded.*completed/s,
    );
    installed = true;
    installedDefinition = fs.readFileSync(definitionPath);
    installedScmPathName = JSON.parse(servicePresence()).PathName;
    const refusedRecovery = spawnSync(
        process.execPath,
        [bin, "recover", "--operation", "not-owned-by-this-install", "--system"],
        { cwd: runtime, env, encoding: "utf8", timeout: 60_000 },
    );
    assert.notEqual(refusedRecovery.status, 0);
    assert.match(refusedRecovery.stdout, /保留恢复记录|未重放|无法证明/);
    assert.ok(fs.readFileSync(definitionPath).equals(installedDefinition));
    assert.equal(JSON.parse(servicePresence()).PathName, installedScmPathName);
    fs.writeFileSync(marker, randomBytes(16).toString("hex"));
    const preserved = fs.readFileSync(marker, "utf8");
    cli(bin, ["start", "--system"]);
    const health = await eventually(() => request("/health"));
    assert.equal(health.ready, true);
    const remotePipe = spawnSync(
        host,
        ["status", "--pipe", "\\\\localhost\\pipe\\onebots-gateway-control"],
        { cwd: runtime, encoding: "utf8", timeout: 10_000 },
    );
    assert.notEqual(remotePipe.status, 0, "远程 UNC 客户端不应连接本机管理管道");
    const systemStatus = JSON.parse(cli(bin, ["status", "--system", "--json"]));
    assert.equal(systemStatus.installation, "control");
    assert.equal(systemStatus.manager.state, "running");
    assert.equal(systemStatus.manager.loaded, true);
    assert.ok(Number.isSafeInteger(systemStatus.manager.pid) && systemStatus.manager.pid > 0);
    assert.equal(systemStatus.manager.ipc, "available");
    assert.equal(systemStatus.diagnostic, null);
    const code = cli(bin, ["auth", "bootstrap", "--data-dir", workspace]);
    const paired = await request("/api/control/auth/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
    });
    assert.match(paired.token, /^[A-Za-z0-9_-]+$/);
    const initial = JSON.parse(
        cli(bin, ["control", "status", "--url", origin, "--auth-stdin"], paired.token),
    );
    assert.equal(initial.processOwnership.available, true);
    const firstManager = initial.manager.id;
    const firstGatewayPid = initial.gateway.instance?.pid;
    assert.ok(Number.isSafeInteger(firstGatewayPid) && firstGatewayPid > 0);
    const restart = JSON.parse(
        cli(bin, ["control", "restart", "--url", origin, "--auth-stdin"], paired.token),
    );
    assert.equal(restart.status, "succeeded");
    const afterGatewayRestart = JSON.parse(
        cli(bin, ["control", "status", "--url", origin, "--auth-stdin"], paired.token),
    );
    assert.notEqual(afterGatewayRestart.gateway.instance?.pid, firstGatewayPid);
    assert.equal(
        powershell(
            `if(Get-Process -Id ${firstGatewayPid} -ErrorAction SilentlyContinue){'live'}else{'gone'}`,
        ),
        "gone",
    );
    const nativeBefore = JSON.parse(
        run(host, ["status", "--pipe", "\\\\.\\pipe\\onebots-gateway-control"]),
    );
    const managerPid = nativeBefore.state.manager.pid;
    cli(bin, ["restart", "--system"]);
    const afterRestart = await eventually(async () => {
        const value = JSON.parse(
            cli(bin, ["control", "status", "--url", origin, "--auth-stdin"], paired.token),
        );
        assert.notEqual(value.manager.id, firstManager);
        return value;
    });
    assert.equal(afterRestart.gateway.desired, initial.gateway.desired);
    assert.equal(fs.readFileSync(marker, "utf8"), preserved);
    assert.equal(
        powershell(
            `if(Get-Process -Id ${managerPid} -ErrorAction SilentlyContinue){'live'}else{'gone'}`,
        ),
        "gone",
    );
    cli(bin, ["stop", "--system"]);
    assert.equal(
        powershell(`(Get-CimInstance Win32_Service -Filter \"Name='${service}'\").State`),
        "Stopped",
    );
    cli(bin, ["uninstall", "--system"]);
    installed = false;
    assert.equal(
        powershell(
            `if(Get-CimInstance Win32_Service -Filter \"Name='${service}'\"){'present'}else{'absent'}`,
        ),
        "absent",
    );
    assert.equal(fs.readFileSync(marker, "utf8"), preserved);
    const leaked = powershell(
        `$p=${JSON.stringify(workspace)};@(Get-CimInstance Win32_Process|Where-Object{$_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$p+'*')}|Select-Object -ExpandProperty ProcessId)|ConvertTo-Json -Compress`,
    );
    assert.ok(leaked === "" || leaked === "null" || leaked === "[]", `遗留进程: ${leaked}`);
    process.stdout.write(
        "✓ Windows SCM 安装、启动、Web、网关重启、manager重启、停止和卸载闭环通过\n",
    );
} finally {
    // 只在契约文件和 SCM 身份仍精确属于本次安装时使用产品公开卸载。
    // 未知结果保留 runner 现场，避免 raw sc stop/delete 掩盖产品失败。
    if (installed && stillOwnsInstallation()) {
        try {
            cli(path.join(runtime, "node_modules", "onebots", "lib", "bin.js"), [
                "uninstall",
                "--system",
            ]);
        } catch (error) {
            process.stderr.write(`Windows 验收清理未确认，保留现场: ${error.message}\n`);
        }
    }
}
