/**
 * 在全新 CI 容器内执行，Token 只从本脚本 stdin 进入，再通过 stdin 交给公开 CLI。
 * 不使用 ControlClient、HTTP 私有接口或 ICQQ 登录；失败信息不得包含下载凭据。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const CLI = "/app/packages/onebots/lib/bin.js";
const WORKSPACE = "/data";
const CONTROL = path.join(WORKSPACE, ".control");
const TERMINAL_PHASES = new Set(["verified", "failed", "interrupted"]);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const cleanEnvironment = { ...process.env, NO_COLOR: "1" };
for (const name of Object.keys(cleanEnvironment)) {
    if (
        [
            "node_auth_token",
            "npm_token",
            "github_token",
            "gh_token",
            "gh_pkg_token",
            "onebots_install_github_token",
            "npm_config_userconfig",
        ].includes(name.toLowerCase())
    )
        delete cleanEnvironment[name];
}

const transcript = [];
function invoke(args, input) {
    const result = spawnSync(process.execPath, [CLI, ...args, "--data-dir", WORKSPACE], {
        cwd: "/app/development",
        encoding: "utf8",
        env: cleanEnvironment,
        ...(input === undefined ? {} : { input }),
        timeout: 75_000,
        maxBuffer: 1024 * 1024,
    });
    transcript.push(result.stdout ?? "", result.stderr ?? "");
    assert.equal(result.status, 0, `公开 CLI 命令失败：onebots ${args[0]} ${args[1] ?? ""}`);
    try {
        return JSON.parse((result.stdout ?? "").trim());
    } catch {
        assert.fail(`公开 CLI 未返回 JSON：onebots ${args[0]} ${args[1] ?? ""}`);
    }
}

function control(...args) {
    return invoke(["control", ...args]);
}

function install(planId, requestId, token) {
    return invoke(
        ["control", "install", "--plan", planId, "--request", requestId, "--auth-stdin"],
        token,
    );
}

async function installation(requestId) {
    const deadline = Date.now() + 10 * 60_000;
    let operation;
    while (Date.now() < deadline) {
        operation = control("installation", "--request", requestId);
        if (TERMINAL_PHASES.has(operation.phase)) return operation;
        await wait(500);
    }
    assert.fail("私有依赖安装未在期限内结束");
}

function assertCredentialDirectoriesClean() {
    for (const directory of [
        path.join(CONTROL, "downloads"),
        path.join(CONTROL, ".download-credentials"),
    ]) {
        if (!fs.existsSync(directory)) continue;
        assert.deepEqual(fs.readdirSync(directory), [], "安装结束后仍存在下载凭据目录");
    }
}

function assertSecretAbsent(secret) {
    const needle = Buffer.from(secret);
    assert.equal(
        transcript.some(output => output.includes(secret)),
        false,
        "CLI 输出泄露下载凭据",
    );
    const pending = [WORKSPACE];
    while (pending.length) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            const stat = fs.lstatSync(filename);
            if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO()) continue;
            if (stat.isDirectory()) pending.push(filename);
            else if (stat.isFile())
                assert.equal(
                    fs.readFileSync(filename).includes(needle),
                    false,
                    "工作区文件泄露下载凭据",
                );
        }
    }
}

function assertBlankConfiguration(content) {
    const require = createRequire(CLI);
    const yaml = require("js-yaml");
    const parsed = yaml.load(content);
    assert.deepEqual(Object.keys(parsed).sort(), ["plugins"]);
    assert.deepEqual(parsed.plugins, { adapters: [], protocols: [], applications: [] });
}

let authorization = "";
for await (const chunk of process.stdin) {
    authorization += chunk.toString();
    if (Buffer.byteLength(authorization) > 512) assert.fail("CI 下载授权格式无效");
}
authorization = authorization.trim();
assert.equal(
    /^[A-Za-z0-9_]+$/.test(authorization),
    true,
    "CI 未提供有效的 GitHub Packages 下载授权",
);

const initialStatus = control("status");
assert.equal(initialStatus.generation.active, null, "私有依赖验收必须在首次激活前执行");
assert.equal(initialStatus.gateway.desired, "stopped");
assert.equal(initialStatus.gateway.actual, "stopped");
const configPath = path.join(WORKSPACE, "config.yaml");
const initialConfig = fs.readFileSync(configPath, "utf8");
assertBlankConfiguration(initialConfig);

const plan = control("plan", "--adapters", "icqq");
assert.deepEqual(plan.selection, { adapters: ["icqq"], protocols: [], applications: [] });
assert.ok(plan.packages.some(item => item.name === "@onebots/adapter-icqq"));
assert.ok(
    plan.peers.some(
        item => item.requestedBy === "@onebots/adapter-icqq" && item.packageName === "@icqqjs/icqq",
    ),
    "ICQQ 安装计划未包含必需 peer",
);

const rejectedToken = `invalid_${randomUUID().replaceAll("-", "")}`;
const rejectedRequest = `private-rejected-${randomUUID()}`;
install(plan.id, rejectedRequest, rejectedToken);
const rejected = await installation(rejectedRequest);
assert.equal(rejected.phase, "failed", "错误 Token 必须导致真实私有 peer 下载失败");
assert.equal(rejected.error, "DOWNLOAD_FAILED");
assertCredentialDirectoriesClean();
assertSecretAbsent(rejectedToken);
const afterRejected = control("status");
assert.deepEqual(afterRejected.generation.active, initialStatus.generation.active);
assert.equal(afterRejected.gateway.desired, initialStatus.gateway.desired);
assert.equal(afterRejected.gateway.actual, initialStatus.gateway.actual);
assert.equal(fs.readFileSync(configPath, "utf8"), initialConfig);

const acceptedRequest = `private-accepted-${randomUUID()}`;
install(plan.id, acceptedRequest, authorization);
const accepted = await installation(acceptedRequest);
assert.equal(accepted.phase, "verified", "有效 Token 必须完成私有 peer 下载和候选验证");
assert.equal(accepted.planDigest, plan.planDigest);
assert.match(accepted.candidateId, /^[a-f0-9-]{36}$/);
assertCredentialDirectoriesClean();
assertSecretAbsent(authorization);
authorization = "";

const generation = path.join(CONTROL, "generations", accepted.candidateId);
const receipt = JSON.parse(fs.readFileSync(path.join(generation, "receipt.json"), "utf8"));
assert.equal(receipt.operationId, acceptedRequest);
assert.ok(Object.values(receipt.checks).every(value => value === true));
const adapterManifest = JSON.parse(
    fs.readFileSync(
        path.join(generation, "node_modules/@onebots/adapter-icqq/package.json"),
        "utf8",
    ),
);
const peerManifest = JSON.parse(
    fs.readFileSync(path.join(generation, "node_modules/@icqqjs/icqq/package.json"), "utf8"),
);
assert.equal(adapterManifest.name, "@onebots/adapter-icqq");
assert.equal(peerManifest.name, "@icqqjs/icqq");
const generationRequire = createRequire(path.join(generation, "package.json"));
for (const packageName of ["@onebots/adapter-icqq", "@icqqjs/icqq"]) {
    const resolved = fs.realpathSync(generationRequire.resolve(packageName));
    assert.ok(resolved.startsWith(`${generation}${path.sep}`), `${packageName} 未解析到候选版本`);
}

const activation = control("activate", "--generation", accepted.candidateId);
assert.equal(activation.status, "succeeded");
await wait(1_000);
const active = control("status");
assert.equal(active.generation.active.id, accepted.candidateId);
assert.equal(active.gateway.desired, "stopped", "激活依赖不应改变网关停止意图");
assert.equal(active.gateway.actual, "stopped", "空配置不得自动启动或连接 ICQQ");
assert.equal(fs.readFileSync(configPath, "utf8"), initialConfig, "安装和激活不得创建账号配置");
assertBlankConfiguration(initialConfig);

process.stdout.write(
    "[onebots] ICQQ 私有 peer 的失败关闭、凭据清理、真实安装与空配置激活验收通过\n",
);
