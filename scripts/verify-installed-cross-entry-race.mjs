/**
 * Production-install the published management surface, start it through the installed CLI, then
 * race the installed CLI's local control connection against the authenticated HTTP API used by
 * the Web console. Browser rendering is intentionally outside this fixture: the installed Web
 * artifact is served and the HTTP participant uses a real paired device session, while all
 * mutations stay on the two public control entries.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync("/tmp/ob-installed-cross-entry-race-");
const archives = path.join(temporary, "archives");
const runtime = path.join(temporary, "runtime");
const workspace = path.join(temporary, "workspace");
for (const directory of [archives, runtime, workspace])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const packageSources = new Map([
    ["@onebots/core", path.join(root, "packages/core")],
    ["@onebots/web", path.join(root, "packages/web")],
    ["onebots", path.join(root, "packages/onebots")],
]);
const environment = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: path.join(temporary, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global-npmrc"),
    NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
};
fs.writeFileSync(environment.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
fs.writeFileSync(environment.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
    );
    return address.port;
}

async function waitFor(read, description, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const result = await read();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(
        `${description}超时${lastError instanceof Error ? `：${lastError.message}` : ""}`,
    );
}

function runCli(bin, args, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [bin, ...args], {
            cwd: runtime,
            env: environment,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout = [];
        const stderr = [];
        let size = 0;
        const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
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
            resolve({
                code,
                stdout: Buffer.concat(stdout).toString("utf8").trim(),
                stderr: Buffer.concat(stderr).toString("utf8").trim(),
            });
        });
        child.stdin.end(input);
    });
}

async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    let closed = false;
    const exited = new Promise(resolve =>
        child.once("close", () => {
            closed = true;
            resolve();
        }),
    );
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10_000))]);
    if (!closed) {
        child.kill("SIGKILL");
        await exited;
    }
}

let manager;
let safeToRemove = true;
try {
    const artifacts = new Map();
    const packedFiles = new Set();
    for (const [name, directory] of packageSources) {
        execFileSync("pnpm", ["pack", "--pack-destination", archives], {
            cwd: directory,
            env: process.env,
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 2 * 60_000,
        });
        const candidates = fs
            .readdirSync(archives)
            .filter(file => file.endsWith(".tgz") && !packedFiles.has(file));
        assert.equal(candidates.length, 1, `无法唯一确认 ${name} 的打包工件`);
        packedFiles.add(candidates[0]);
        const file = path.join(archives, candidates[0]);
        const manifest = JSON.parse(execFileSync("tar", ["-xOf", file, "package/package.json"]));
        assert.equal(manifest.name, name);
        artifacts.set(name, { spec: `file:${file}` });
    }

    fs.writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({ name: "onebots-installed-cross-entry-race", private: true }),
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
            ...["@onebots/core", "@onebots/web", "onebots"].map(name => artifacts.get(name).spec),
        ],
        {
            cwd: runtime,
            env: environment,
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 10 * 60_000,
        },
    );

    const packageRoot = path.join(runtime, "node_modules/onebots");
    const bin = path.join(packageRoot, "lib/bin.js");
    const data = ["--data-dir", workspace];
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const managerOutput = [];
    manager = spawn(
        process.execPath,
        [bin, "serve", ...data, "--host", "127.0.0.1", "--port", String(port)],
        { cwd: runtime, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const stream of [manager.stdout, manager.stderr])
        stream.on("data", chunk => {
            if (managerOutput.reduce((size, value) => size + value.length, 0) < 1024 * 1024)
                managerOutput.push(chunk);
        });
    const managerFailed = new Promise((_, reject) =>
        manager.once("exit", code =>
            reject(
                new Error(
                    `安装后的管理服务提前退出 ${code}：${Buffer.concat(managerOutput).toString("utf8")}`,
                ),
            ),
        ),
    );
    safeToRemove = false;
    await Promise.race([
        waitFor(async () => {
            const response = await fetch(`${baseUrl}/ready`);
            return response.ok ? response.json() : undefined;
        }, "安装后的管理服务启动"),
        managerFailed,
    ]);

    const installedIndex = fs.readFileSync(
        path.join(runtime, "node_modules/@onebots/web/dist/index.html"),
        "utf8",
    );
    const servedIndex = await fetch(`${baseUrl}/`);
    assert.equal(servedIndex.status, 200);
    assert.equal(await servedIndex.text(), installedIndex, "HTTP 入口必须托管安装后的 Web 工件");

    const bootstrap = await runCli(bin, ["auth", "bootstrap", ...data]);
    assert.equal(bootstrap.code, 0, bootstrap.stderr);
    assert.match(bootstrap.stdout, /^[A-Za-z0-9_-]+$/);
    const paired = await fetch(`${baseUrl}/api/control/auth/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: bootstrap.stdout }),
    });
    assert.equal(paired.status, 200);
    const { token } = await paired.json();
    assert.equal(typeof token, "string");
    assert.ok(token.length > 20);

    async function webRequest(method, route, body) {
        const response = await fetch(`${baseUrl}${route}`, {
            method,
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            redirect: "error",
        });
        const value = await response.json();
        return { status: response.status, body: value };
    }
    function cliJson(result) {
        assert.equal(result.code, 0, result.stderr);
        return JSON.parse(result.stdout);
    }
    const cliConfiguration = (action, args = [], input) =>
        runCli(bin, ["control", "config", action, ...data, ...args], input);

    const initial = await webRequest("GET", "/api/control/status");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.gateway.actual, "running");

    // Both entries deliberately use the same draft revision. Exactly one CAS may win.
    const snapshot = await webRequest("GET", "/api/control/configuration");
    assert.equal(snapshot.status, 200);
    const created = await webRequest("POST", "/api/control/configuration/drafts", {
        base: snapshot.body.base,
    });
    assert.equal(created.status, 201);
    const draft = created.body;
    const cliEdit = cliConfiguration(
        "edit",
        ["--draft", draft.id, "--stdin"],
        JSON.stringify({
            expectedRevision: draft.revision,
            changes: [{ op: "set", path: ["log_level"], value: "debug" }],
            secrets: [],
        }),
    );
    await new Promise(resolve => setTimeout(resolve, 25));
    const [cliEditResult, webEdit] = await Promise.all([
        cliEdit,
        webRequest("POST", `/api/control/configuration/drafts/${draft.id}/edit`, {
            expectedRevision: draft.revision,
            changes: [{ op: "set", path: ["log_level"], value: "warn" }],
            secrets: [],
        }),
    ]);
    assert.equal(
        Number(cliEditResult.code === 0) + Number(webEdit.status === 200),
        1,
        "同一陈旧 revision 的跨入口写入必须恰好一个成功",
    );
    assert.ok([200, 409].includes(webEdit.status));
    const racedDraft = (await webRequest("GET", `/api/control/configuration/drafts/${draft.id}`))
        .body;
    assert.equal(racedDraft.document.log_level, cliEditResult.code === 0 ? "debug" : "warn");

    const validated = await webRequest(
        "POST",
        `/api/control/configuration/drafts/${draft.id}/validate`,
        { expectedRevision: racedDraft.revision },
    );
    assert.equal(validated.status, 200);
    assert.equal(validated.body.valid, true);
    assert.equal(typeof validated.body.receiptId, "string");

    // The same operation and receipt may arrive through both public entries concurrently.
    const sharedOperationId = `cross-apply-${randomUUID()}`;
    const cliApply = cliConfiguration("apply", [
        "--request",
        sharedOperationId,
        "--receipt",
        validated.body.receiptId,
    ]);
    await new Promise(resolve => setTimeout(resolve, 25));
    const [cliApplyResult, webApply] = await Promise.all([
        cliApply,
        webRequest("POST", "/api/control/configuration/apply", {
            id: sharedOperationId,
            receiptId: validated.body.receiptId,
        }),
    ]);
    const cliApplied = cliJson(cliApplyResult);
    assert.equal(webApply.status, 202);
    for (const operation of [cliApplied, webApply.body]) {
        assert.equal(operation.id, sharedOperationId);
        assert.equal(operation.validationId, validated.body.receiptId);
        assert.ok(["running", "succeeded"].includes(operation.status));
    }
    assert.ok(
        [cliApplied, webApply.body].some(operation => operation.status === "succeeded"),
        "同键并发中的首个调用必须完成配置事务",
    );
    const sharedApplied = await waitFor(async () => {
        const operation = (
            await webRequest("GET", `/api/control/configuration/operations/${sharedOperationId}`)
        ).body;
        return operation.status === "succeeded" ? operation : undefined;
    }, "跨入口并发 apply 收敛到唯一终态");

    const afterFirstApply = await webRequest("GET", "/api/control/configuration");
    const conflictDraft = await webRequest("POST", "/api/control/configuration/drafts", {
        base: afterFirstApply.body.base,
    });
    assert.equal(conflictDraft.status, 201);
    const changed = await webRequest(
        "POST",
        `/api/control/configuration/drafts/${conflictDraft.body.id}/edit`,
        {
            expectedRevision: conflictDraft.body.revision,
            changes: [{ op: "set", path: ["log_level"], value: "error" }],
            secrets: [],
        },
    );
    assert.equal(changed.status, 200);
    const conflictValidation = await webRequest(
        "POST",
        `/api/control/configuration/drafts/${conflictDraft.body.id}/validate`,
        { expectedRevision: changed.body.revision },
    );
    assert.equal(conflictValidation.status, 200);
    assert.equal(conflictValidation.body.valid, true);
    const conflictingRetry = await webRequest("POST", "/api/control/configuration/apply", {
        id: sharedOperationId,
        receiptId: conflictValidation.body.receiptId,
    });
    assert.equal(conflictingRetry.status, 409, "相同幂等键绑定不同回执必须冲突");
    assert.deepEqual(
        cliJson(await cliConfiguration("operation", ["--request", sharedOperationId])),
        sharedApplied,
    );

    // Dispatch a third apply over HTTP, discard its response, then reconcile only by its original ID.
    const lostOperationId = `lost-apply-${randomUUID()}`;
    const lostReceipt = conflictValidation.body.receiptId;
    const lostResponse = await new Promise(resolve => {
        const request = http.request(
            `${baseUrl}/api/control/configuration/apply`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
            },
            response => {
                response.resume();
                resolve("received");
            },
        );
        request.once("error", () => resolve("lost"));
        request.once("finish", () =>
            setTimeout(() => request.destroy(new Error("模拟调用方丢失响应")), 10),
        );
        request.end(JSON.stringify({ id: lostOperationId, receiptId: lostReceipt }));
    });
    assert.equal(lostResponse, "lost", "夹具必须在收到 HTTP 响应前断开调用方连接");

    const observed = await waitFor(async () => {
        const result = await cliConfiguration("operation", ["--request", lostOperationId]);
        if (result.code !== 0) return undefined;
        const operation = JSON.parse(result.stdout);
        return ["succeeded", "failed", "interrupted"].includes(operation.status)
            ? operation
            : undefined;
    }, "CLI 按原 operation ID 查询丢失响应后的配置应用");
    assert.equal(observed.id, lostOperationId);
    assert.equal(observed.status, "succeeded");
    const sameRetry = await webRequest("POST", "/api/control/configuration/apply", {
        id: lostOperationId,
        receiptId: lostReceipt,
    });
    assert.equal(sameRetry.status, 202);
    assert.deepEqual(sameRetry.body, observed);
    assert.equal(
        (await webRequest("GET", "/api/control/configuration")).body.document.log_level,
        "error",
    );

    const webOperationLog = await webRequest("GET", "/api/control/logs?source=operation");
    assert.equal(webOperationLog.status, 200);
    const cliOperationLog = await runCli(bin, [
        "control",
        "logs",
        ...data,
        "--source",
        "operation",
    ]);
    assert.equal(cliOperationLog.code, 0, cliOperationLog.stderr);
    assert.equal(
        cliOperationLog.stdout,
        webOperationLog.body.text.trim(),
        "CLI 与 Web 必须读取同一份 manager 操作日志",
    );
    for (const id of [sharedOperationId, lostOperationId]) {
        const records = webOperationLog.body.text
            .trim()
            .split("\n")
            .map(line => JSON.parse(line))
            .filter(record => record.id === id);
        assert.equal(records.length, 1, `配置操作 ${id} 只能生成一个终态投影`);
        assert.deepEqual(records[0], {
            time: records[0].time,
            id,
            action: "configuration.apply",
            status: "succeeded",
            phase: "completed",
        });
    }

    await stop(manager);
    manager = undefined;
    safeToRemove = true;
    process.stdout.write(
        "✓ 安装产物的 CLI 与已配对 Web HTTP 会话通过同一 manager 验证了陈旧 revision CAS、跨入口并发 apply、同键同载荷重试、同键异载荷冲突、丢响应后按原 operation 查询，以及两入口的单一终态操作日志\n",
    );
} finally {
    if (manager) {
        await stop(manager);
        safeToRemove = true;
    }
    if (safeToRemove) fs.rmSync(temporary, { recursive: true, force: true });
    else process.stderr.write(`验收状态未确认，保留临时目录 ${temporary}\n`);
}
