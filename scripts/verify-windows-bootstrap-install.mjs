import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Windows bootstrap acceptance requires win32");

const repository = path.resolve(import.meta.dirname, "..");
const script = path.join(repository, "docs/src/public/install.ps1");
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
        batch(String.raw`@echo off
if "%~1"=="--input-type=module" goto capability-joined
if "%~1"=="--input-type" if "%~2"=="module" goto capability-split
if "%~1"=="-p" (
  if not "%~2"=="parseInt(process.versions.node, 10)" goto exit-nine
  echo 24
  goto exit-zero
)
shift
echo cli %*>>"%ONEBOTS_TEST_LOG%"
if defined NODE_AUTH_TOKEN goto exit-eight
if defined NPM_TOKEN goto exit-eight
if defined SYNTHETIC_AUTH goto exit-eight
if "%~1"=="install" (
  >>"%ONEBOTS_TEST_LOG%" echo cli-command install
  if "%ONEBOTS_TEST_MODE%"=="install-fail" (
    >>"%ONEBOTS_TEST_LOG%" echo cli-mode install-fail
    >>"%ONEBOTS_TEST_LOG%" echo cli-exit 3
    goto exit-three
  )
  >>"%ONEBOTS_TEST_LOG%" echo cli-mode other
  >>"%ONEBOTS_TEST_LOG%" echo cli-exit 0
  goto exit-zero
)
if "%~1"=="status" (
  >>"%ONEBOTS_TEST_LOG%" echo cli-command status
  if "%ONEBOTS_TEST_MODE%"=="status-fail" (
    >>"%ONEBOTS_TEST_LOG%" echo cli-mode status-fail
    >>"%ONEBOTS_TEST_LOG%" echo cli-exit 3
    goto exit-three
  )
  if "%ONEBOTS_TEST_MODE%"=="invalid-status" echo {}
  if "%ONEBOTS_TEST_MODE%"=="unexpected-running" echo {"schemaVersion":1,"installation":"control","manager":{"state":"running","ipc":"available"},"serviceRecoveryRequired":false,"diagnostic":null,"gateway":{"actual":"unknown","desired":"unknown","recoveryRequired":null}}
  if not "%ONEBOTS_TEST_MODE%"=="invalid-status" if not "%ONEBOTS_TEST_MODE%"=="unexpected-running" echo {"schemaVersion":1,"installation":"control","manager":{"state":"stopped","ipc":"not-queried"},"serviceRecoveryRequired":false,"diagnostic":null,"gateway":{"actual":"unknown","desired":"unknown","recoveryRequired":null}}
  >>"%ONEBOTS_TEST_LOG%" echo cli-exit 0
  goto exit-zero
)
>>"%ONEBOTS_TEST_LOG%" echo cli-command unknown
>>"%ONEBOTS_TEST_LOG%" echo cli-exit 10
goto exit-ten
:capability-joined
>>"%ONEBOTS_TEST_LOG%" echo capability-argument joined
goto capability
:capability-split
>>"%ONEBOTS_TEST_LOG%" echo capability-argument split
:capability
if defined NODE_AUTH_TOKEN goto exit-eight
if defined NPM_TOKEN goto exit-eight
if defined SYNTHETIC_AUTH goto exit-eight
if defined ONEBOTS_BOOTSTRAP_CODE goto exit-eight
if defined ONEBOTS_RECOVERY_CODE goto exit-eight
"%ONEBOTS_TEST_REAL_NODE%" %*
set "ONEBOTS_TEST_PROBE_RESULT=%ERRORLEVEL%"
>>"%ONEBOTS_TEST_LOG%" echo capability-exit %ONEBOTS_TEST_PROBE_RESULT%
exit /b %ONEBOTS_TEST_PROBE_RESULT%
:exit-zero
set "ONEBOTS_TEST_EXIT_CODE=0"
goto return-result
:exit-three
set "ONEBOTS_TEST_EXIT_CODE=3"
goto return-result
:exit-eight
set "ONEBOTS_TEST_EXIT_CODE=8"
goto return-result
:exit-nine
set "ONEBOTS_TEST_EXIT_CODE=9"
goto return-result
:exit-ten
set "ONEBOTS_TEST_EXIT_CODE=10"
:return-result
"%ONEBOTS_TEST_REAL_NODE%" -e "process.exit(%ONEBOTS_TEST_EXIT_CODE%)"
set "ONEBOTS_TEST_EXIT_RESULT=%ERRORLEVEL%"
>>"%ONEBOTS_TEST_LOG%" echo node-exit %ONEBOTS_TEST_EXIT_RESULT%
exit /b %ONEBOTS_TEST_EXIT_RESULT%
`),
    );
    fs.writeFileSync(
        path.join(bin, "npm.cmd"),
        batch(String.raw`@echo off
echo npm %*>>"%ONEBOTS_TEST_LOG%"
if defined NODE_AUTH_TOKEN goto exit-eight
if defined NPM_TOKEN goto exit-eight
if defined SYNTHETIC_AUTH goto exit-eight
if not exist "%NPM_CONFIG_USERCONFIG%" goto exit-eight
if not exist "%NPM_CONFIG_GLOBALCONFIG%" goto exit-eight
if "%ONEBOTS_TEST_MODE%"=="npm-fail" goto exit-three
mkdir node_modules\onebots\lib\control
mkdir node_modules\onebots\lib\gateway
mkdir node_modules\onebots\lib\native\win32-x64
mkdir node_modules\@onebots\web\dist
echo {"name":"onebots","type":"module"}>node_modules\onebots\package.json
echo bin>node_modules\onebots\lib\bin.js
if "%ONEBOTS_TEST_MODE%"=="missing-capability" echo export {};>node_modules\onebots\lib\control\host.js
if not "%ONEBOTS_TEST_MODE%"=="missing-capability" echo export const WORKSPACE_ADMISSION_CAPABILITY=1;>node_modules\onebots\lib\control\host.js
echo gateway>node_modules\onebots\lib\gateway\entry.js
if not "%ONEBOTS_TEST_MODE%"=="missing-native" echo native>node_modules\onebots\lib\native\win32-x64\onebots-windows-host.exe
echo web>node_modules\@onebots\web\dist\index.html
goto exit-zero
:exit-zero
set "ONEBOTS_TEST_EXIT_CODE=0"
goto return-result
:exit-three
set "ONEBOTS_TEST_EXIT_CODE=3"
goto return-result
:exit-eight
set "ONEBOTS_TEST_EXIT_CODE=8"
:return-result
"%ONEBOTS_TEST_REAL_NODE%" -e "process.exit(%ONEBOTS_TEST_EXIT_CODE%)"
set "ONEBOTS_TEST_EXIT_RESULT=%ERRORLEVEL%"
>>"%ONEBOTS_TEST_LOG%" echo npm-exit %ONEBOTS_TEST_EXIT_RESULT%
exit /b %ONEBOTS_TEST_EXIT_RESULT%
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
                    ONEBOTS_TEST_REAL_NODE: process.execPath,
                    ONEBOTS_TEST_LOG: log,
                    ONEBOTS_TEST_MODE: mode,
                    NODE_AUTH_TOKEN: "private-download-token",
                    NPM_TOKEN: "private-npm-token",
                    SYNTHETIC_AUTH: "private-auth-value",
                },
            },
        );
    const probeScript = path.join(root, "probe.ps1");
    fs.writeFileSync(
        probeScript,
        String.raw`$ErrorActionPreference = 'Stop'
$Bin = Join-Path $env:ONEBOTS_HOME 'runtime/node_modules/onebots/lib/bin.js'
$Arguments = @($Bin, 'install', '--system', '--data-dir', (Join-Path $env:ONEBOTS_HOME 'data'))
if ($env:ONEBOTS_TEST_PROBE_KIND -eq 'capability') {
    $Arguments = @('--input-type=module', '-e', "process.exit( $env:ONEBOTS_TEST_EXPECTED_EXIT );")
} elseif ($env:ONEBOTS_TEST_PROBE_KIND -eq 'version') {
    $Arguments = @('-p', 'unsupported-version-expression')
} elseif ($env:ONEBOTS_TEST_PROBE_KIND -eq 'unknown') {
    $Arguments = @($Bin, 'unknown')
} elseif ($env:ONEBOTS_TEST_PROBE_KIND -eq 'secret') {
    $env:SYNTHETIC_AUTH = 'synthetic-probe-secret'
}
& (Join-Path $PSScriptRoot 'bin/node.cmd') @Arguments
exit $LASTEXITCODE
`,
    );
    const probe = (exitCode, kind = "capability") => {
        const env = { ...process.env };
        for (const name of Object.keys(env))
            if (
                /token|auth/i.test(name) ||
                /^npm_config_/i.test(name) ||
                ["NODE_OPTIONS", "ONEBOTS_BOOTSTRAP_CODE", "ONEBOTS_RECOVERY_CODE"].includes(name)
            )
                delete env[name];
        return spawnSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                probeScript,
            ],
            {
                encoding: "utf8",
                env: {
                    ...env,
                    ONEBOTS_TEST_REAL_NODE: process.execPath,
                    ONEBOTS_TEST_LOG: log,
                    ONEBOTS_TEST_EXPECTED_EXIT: String(exitCode),
                    ONEBOTS_TEST_PROBE_KIND: kind,
                    ONEBOTS_TEST_MODE: mode,
                    ONEBOTS_HOME: home,
                },
            },
        );
    };
    return {
        home,
        log,
        run,
        probe,
        commands: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    };
}

function failureDiagnostic(test, result) {
    return JSON.stringify({
        trace: test
            .commands()
            .split(/\r?\n/u)
            .filter(line =>
                /^(?:capability-argument (?:joined|split)|capability-exit (?:0|1|7|8|10)|cli-command (?:install|status|unknown)|cli-mode (?:install-fail|status-fail|other)|cli-exit (?:0|3|8|10)|(?:node|npm)-exit (?:0|3|8|9|10))$/u.test(
                    line,
                ),
            ),
        successMessage: (result.stdout ?? "").includes("管理服务已安装并保持停止"),
        installationFailure: ((result.stdout ?? "") + (result.stderr ?? "")).includes(
            "安装未完成：",
        ),
        markerExists: fs.existsSync(path.join(test.home, ".manager-installed")),
    });
}

try {
    // Exercise the same PowerShell array -> CMD -> real Node bridge before trusting the mock.
    // CMD can split the unquoted '=' argument; %* must still forward the original command.
    const bridge = fixture();
    for (const exitCode of [0, 7]) {
        const result = bridge.probe(exitCode);
        assert.equal(result.error, undefined);
        assert.equal(result.status, exitCode, "capability bridge changed the real Node exit code");
    }
    assert.deepEqual(
        [...bridge.commands().matchAll(/^capability-exit (\d+)\r?$/gmu)].map(match =>
            Number(match[1]),
        ),
        [0, 7],
    );
    const forms = [...bridge.commands().matchAll(/^capability-argument (joined|split)\r?$/gmu)].map(
        match => match[1],
    );
    assert.equal(forms.length, 2);
    assert.doesNotMatch(bridge.commands(), /^cli /mu);
    process.stdout.write(`Windows capability bridge argument forms: ${forms.join(",")}\n`);

    for (const [mode, kind, exitCode] of [
        ["ok", "install", 0],
        ["install-fail", "install", 3],
        ["ok", "secret", 8],
        ["ok", "version", 9],
        ["ok", "unknown", 10],
    ]) {
        const direct = fixture(mode);
        const result = direct.probe(exitCode, kind);
        assert.equal(result.error, undefined);
        assert.equal(result.status, exitCode, failureDiagnostic(direct, result));
        assert.match(direct.commands(), new RegExp(`^node-exit ${exitCode}\\r?$`, "mu"));
        if (kind === "install") {
            assert.match(direct.commands(), /^cli-command install\r?$/mu);
            assert.match(direct.commands(), new RegExp(`^cli-exit ${exitCode}\\r?$`, "mu"));
        }
        assert.doesNotMatch(direct.commands(), /synthetic-probe-secret/u);
        assert.equal(fs.existsSync(path.join(direct.home, ".manager-installed")), false);
    }
    process.stdout.write("Windows mock executable exit checks: 0,3,8,9,10\n");

    const success = fixture();
    const installed = success.run();
    assert.equal(installed.status, 0, failureDiagnostic(success, installed));
    assert.match(installed.stdout, /管理服务已安装并保持停止/);
    assert.match(success.commands(), /--registry=https:\/\/registry\.npmjs\.org onebots@latest/);
    assert.match(success.commands(), /bin\.js install --system --data-dir/);
    assert.doesNotMatch(success.commands(), /bin\.js (?:start|workspace) /);
    assert.match(
        installed.stdout,
        /workspace register --plan-file ".*workspace-plan\.json" --confirm/,
    );
    assert.match(success.commands(), /bin\.js status --system --json/);
    assert.match(success.commands(), /^capability-exit 0\r?$/mu);
    assert.equal([...success.commands().matchAll(/^capability-argument /gmu)].length, 1);
    assert.equal(fs.existsSync(path.join(success.home, "config.yaml")), false);
    assert.equal(
        fs.readFileSync(path.join(success.home, ".manager-installed"), "utf8").trim(),
        "onebots-manager-install-v2-pending",
    );
    assert.doesNotMatch(installed.stdout + installed.stderr + success.commands(), /private-/);
    const before = success.commands();
    const repeated = success.run();
    assert.equal(repeated.status, 0, failureDiagnostic(success, repeated));
    assert.match(repeated.stdout, /已有安装成功/);
    assert.equal(success.commands(), before);

    for (const mode of [
        "npm-fail",
        "missing-native",
        "missing-capability",
        "install-fail",
        "unexpected-running",
        "status-fail",
        "invalid-status",
    ]) {
        const failed = fixture(mode);
        const result = failed.run();
        assert.notEqual(
            result.status,
            0,
            `${mode} unexpectedly succeeded; ${failureDiagnostic(failed, result)}`,
        );
        assert.doesNotMatch(result.stdout, /管理服务已安装并保持停止/);
        assert.equal(fs.existsSync(path.join(failed.home, ".manager-installed")), false);
        assert.equal(fs.existsSync(path.join(failed.home, "runtime")), true);
        if (mode === "unexpected-running" || mode === "invalid-status") {
            assert.match(failed.commands(), /^cli-command status\r?$/mu);
            assert.match(failed.commands(), /^node-exit 0\r?$/mu);
            assert.equal(
                ((result.stdout ?? "") + (result.stderr ?? "")).includes(
                    mode === "unexpected-running"
                        ? "管理服务尚未确认安全停止"
                        : "管理服务状态证据无效",
                ),
                true,
                "status fixtures must exercise distinct semantic and schema rejection paths",
            );
        }
        if (mode === "missing-capability") {
            assert.equal([...failed.commands().matchAll(/^capability-argument /gmu)].length, 1);
            assert.match(failed.commands(), /^capability-exit 1\r?$/mu);
            assert.doesNotMatch(failed.commands(), /bin\.js (?:install|status|start) /u);
        }
        if (mode === "npm-fail" || mode === "install-fail" || mode === "status-fail") {
            const expectedExit = mode === "npm-fail" ? "npm" : "node";
            assert.match(failed.commands(), new RegExp(`^${expectedExit}-exit 3\\r?$`, "mu"));
            const expectedFailure =
                mode === "status-fail" ? "系统服务状态检查失败" : "命令执行失败（退出码 3）";
            assert.equal(
                ((result.stdout ?? "") + (result.stderr ?? "")).includes(expectedFailure),
                true,
                "nonzero command must fail at its exit check, without a later fallback failure",
            );
        }
        if (mode === "install-fail") {
            assert.match(failed.commands(), /^cli-mode install-fail\r?$/mu);
            assert.match(failed.commands(), /^cli-exit 3\r?$/mu);
            assert.doesNotMatch(failed.commands(), /^cli-command status\r?$/mu);
        }
    }
    process.stdout.write("Windows bootstrap installation acceptance passed\n");
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
