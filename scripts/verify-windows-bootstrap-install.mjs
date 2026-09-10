import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Windows bootstrap acceptance requires win32");

const repository = path.resolve(import.meta.dirname, "..");
const script = path.join(repository, "install.ps1");
const roots = [];

function batch(value) {
    return value.replaceAll("\n", "\r\n");
}

function fixture(mode = "ok") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-bootstrap-"));
    roots.push(root);
    const bin = path.join(root, "bin");
    const home = path.join(root, "home");
    const log = path.join(root, "commands.log");
    fs.mkdirSync(bin);
    fs.writeFileSync(
        path.join(bin, "node.cmd"),
        batch(`@echo off
if "%~1"=="-p" (
  echo 24
  exit /b 0
)
shift
echo cli %*>>"%ONEBOTS_TEST_LOG%"
if defined NODE_AUTH_TOKEN exit /b 8
if defined NPM_TOKEN exit /b 8
if defined SYNTHETIC_AUTH exit /b 8
if "%~1"=="install" if "%ONEBOTS_TEST_MODE%"=="install-fail" exit /b 3
if "%~1"=="start" if "%ONEBOTS_TEST_MODE%"=="start-fail" exit /b 3
if "%~1"=="status" (
  if "%ONEBOTS_TEST_MODE%"=="status-fail" exit /b 3
  if "%ONEBOTS_TEST_MODE%"=="invalid-status" echo {}
  if not "%ONEBOTS_TEST_MODE%"=="invalid-status" echo {"schemaVersion":1,"installation":"control","manager":{"state":"running","ipc":"available"},"serviceRecoveryRequired":false,"diagnostic":null,"gateway":{"actual":"stopped","desired":"stopped","recoveryRequired":false}}
)
exit /b 0
`),
    );
    fs.writeFileSync(
        path.join(bin, "npm.cmd"),
        batch(`@echo off
echo npm %*>>"%ONEBOTS_TEST_LOG%"
if defined NODE_AUTH_TOKEN exit /b 8
if defined NPM_TOKEN exit /b 8
if defined SYNTHETIC_AUTH exit /b 8
if not exist "%NPM_CONFIG_USERCONFIG%" exit /b 8
if not exist "%NPM_CONFIG_GLOBALCONFIG%" exit /b 8
if "%ONEBOTS_TEST_MODE%"=="npm-fail" exit /b 3
mkdir node_modules\onebots\lib\control
mkdir node_modules\onebots\lib\gateway
mkdir node_modules\onebots\lib\native\win32-x64
mkdir node_modules\@onebots\web\dist
echo bin>node_modules\onebots\lib\bin.js
echo host>node_modules\onebots\lib\control\host.js
echo gateway>node_modules\onebots\lib\gateway\entry.js
if not "%ONEBOTS_TEST_MODE%"=="missing-native" echo native>node_modules\onebots\lib\native\win32-x64\onebots-windows-host.exe
echo web>node_modules\@onebots\web\dist\index.html
exit /b 0
`),
    );
    const run = () =>
        spawnSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                script,
            ],
            {
                cwd: repository,
                encoding: "utf8",
                env: {
                    ...process.env,
                    PATH: `${bin};${process.env.PATH}`,
                    ONEBOTS_HOME: home,
                    ONEBOTS_TEST_LOG: log,
                    ONEBOTS_TEST_MODE: mode,
                    NODE_AUTH_TOKEN: "private-download-token",
                    NPM_TOKEN: "private-npm-token",
                    SYNTHETIC_AUTH: "private-auth-value",
                },
            },
        );
    return {
        home,
        log,
        run,
        commands: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    };
}

try {
    const success = fixture();
    const installed = success.run();
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /管理服务已安装并确认运行/);
    assert.match(success.commands(), /--registry=https:\/\/registry\.npmjs\.org onebots@latest/);
    assert.match(success.commands(), /bin\.js install --system --data-dir/);
    assert.match(success.commands(), /bin\.js start --system/);
    assert.match(success.commands(), /bin\.js status --system --json/);
    assert.equal(fs.existsSync(path.join(success.home, "config.yaml")), false);
    assert.equal(
        fs.readFileSync(path.join(success.home, ".manager-installed"), "utf8").trim(),
        "onebots-manager-install-v1",
    );
    assert.doesNotMatch(installed.stdout + installed.stderr + success.commands(), /private-/);
    const before = success.commands();
    const repeated = success.run();
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.match(repeated.stdout, /已有安装成功/);
    assert.equal(success.commands(), before);

    for (const mode of [
        "npm-fail",
        "missing-native",
        "install-fail",
        "start-fail",
        "status-fail",
        "invalid-status",
    ]) {
        const failed = fixture(mode);
        const result = failed.run();
        assert.notEqual(result.status, 0, `${mode} unexpectedly succeeded`);
        assert.doesNotMatch(result.stdout, /管理服务已安装并确认运行/);
        assert.equal(fs.existsSync(path.join(failed.home, ".manager-installed")), false);
        assert.equal(fs.existsSync(path.join(failed.home, "runtime")), true);
    }
    process.stdout.write("Windows bootstrap installation acceptance passed\n");
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
