/** 隔离 Compose 项目与临时 bind mount，不触碰现有容器、数据或真实账号。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const image = process.argv[2];
assert.ok(image && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image), "必须指定已构建的测试镜像");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-compose-recreation-"));
const project = `ob-recreation-${randomUUID().replaceAll("-", "")}`;
const data = path.join(root, "data");
const composeFile = path.join(root, "compose.json");
fs.mkdirSync(data);
fs.writeFileSync(
    composeFile,
    JSON.stringify({
        services: {
            onebots: {
                image,
                pull_policy: "never",
                stop_grace_period: "30s",
                volumes: [{ type: "bind", source: data, target: "/data" }],
            },
        },
    }),
);
const docker = (args, input) =>
    execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        ...(input === undefined ? {} : { input }),
    });
const compose = (...args) => docker(["compose", "-p", project, "-f", composeFile, ...args]);
const dataNode = (script, readonly = true) =>
    docker(
        [
            "run",
            "--rm",
            "-i",
            "--mount",
            `type=bind,source=${data},target=/data${readonly ? ",readonly" : ""}`,
            "--entrypoint",
            "node",
            image,
            "--input-type=module",
        ],
        script,
    );
const node = (container, script) =>
    docker(["exec", "-i", "--user", "1000:1000", container, "node", "--input-type=module"], script);
const cli = (container, ...args) =>
    JSON.parse(
        docker([
            "exec",
            "--user",
            "1000:1000",
            container,
            "node",
            "/app/packages/onebots/lib/bin.js",
            "control",
            ...args,
            "--data-dir",
            "/data",
        ]),
    );
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function up() {
    compose("up", "-d");
    const container = compose("ps", "-q", "onebots").trim();
    assert.ok(container, "测试容器未创建");
    const deadline = performance.now() + 60_000;
    let lastError;
    while (performance.now() < deadline) {
        try {
            cli(container, "status");
            return container;
        } catch (error) {
            lastError = error;
        }
        await sleep(200);
    }
    throw lastError ?? new Error("测试管理服务未就绪");
}
function snapshot(container) {
    return JSON.parse(
        node(
            container,
            `
        import fs from 'node:fs'; import os from 'node:os'; import { createHash } from 'node:crypto';
        const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        console.log(JSON.stringify({hostname: os.hostname(), pid: process.pid,
            config: digest('/data/config.yaml'), auth: digest('/data/.control/auth.json')}));
    `,
        ),
    );
}
function protocolStatus(container) {
    return Number(
        node(
            container,
            `
        const response = await fetch('http://127.0.0.1:6727/mock/bot/onebot/v11/get_login_info', {
            method: 'POST', headers: {'content-type': 'application/json'}, body: '{}',
            signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel(); console.log(response.status);
    `,
        ).trim(),
    );
}
async function readyProtocol(container) {
    // gateway.ready 明确只表示管理通道就绪，账号/协议通过 accountsSettled 异步完成。
    // 这里只重试只读 get_login_info；不重试安装、激活、发送等有副作用的操作。
    const deadline = performance.now() + 15_000;
    let status;
    do {
        status = protocolStatus(container);
        if (status === 200) return;
        if (status !== 404 && status !== 503) break;
        await sleep(100);
    } while (performance.now() < deadline);
    assert.equal(status, 200, "Mock 协议未在期限内就绪");
}

let container;
try {
    container = await up();
    // 创建真实管理认证状态，配对码只在子命令内存中，不输出、不写入验收日志。
    docker([
        "exec",
        "--user",
        "1000:1000",
        container,
        "node",
        "/app/packages/onebots/lib/bin.js",
        "auth",
        "bootstrap",
        "--data-dir",
        "/data",
    ]);
    node(
        container,
        fs.readFileSync(new URL("./prepare-compose-recreation.mjs", import.meta.url), "utf8"),
    );
    assert.equal(cli(container, "start").status, "succeeded");
    await readyProtocol(container);
    for (const desired of ["running", "stopped"]) {
        if (desired === "stopped") assert.equal(cli(container, "stop").status, "succeeded");
        const beforeStatus = cli(container, "status");
        assert.equal(beforeStatus.gateway.actual, desired);
        const before = snapshot(container);
        compose("down");
        const receipt = JSON.parse(
            dataNode(`
            import fs from 'node:fs';
            console.log(fs.readFileSync('/data/.control/process-ownership.json','utf8'));
        `),
        );
        assert.equal(receipt.phase, "closed", "正常关闭必须写入 closed 记录");
        assert.equal(receipt.hostname, before.hostname);
        assert.equal(receipt.pid, 1, "验收须覆盖管理服务 PID 1 在容器重建时复用");
        container = await up();
        const after = snapshot(container);
        assert.notEqual(after.hostname, before.hostname, "必须由 Docker 分配新的默认 hostname");
        const status = cli(container, "status");
        assert.deepEqual(status.processOwnership, { available: true });
        assert.equal(status.gateway.desired, desired);
        assert.equal(status.gateway.actual, desired);
        if (desired === "running")
            assert.notEqual(status.gateway.instance.id, beforeStatus.gateway.instance.id);
        assert.equal(after.config, before.config, "重建不得修改配置");
        assert.equal(after.auth, before.auth, "重建不得清空管理认证");
        if (desired === "running") await readyProtocol(container);
        else assert.equal(protocolStatus(container), 503);
    }
    // 非正常关闭不产生 closed 证明，换 hostname 后仍必须保留维护 gate。
    const beforeCrash = snapshot(container);
    compose("kill", "-s", "SIGKILL");
    compose("down");
    container = await up();
    const afterCrash = snapshot(container);
    assert.notEqual(afterCrash.hostname, beforeCrash.hostname);
    assert.deepEqual(cli(container, "status").processOwnership, { available: false });
    assert.equal(afterCrash.config, beforeCrash.config);
    assert.equal(afterCrash.auth, beforeCrash.auth);
    assert.equal(protocolStatus(container), 503);
    console.log(
        "[onebots] Compose down/up：hostname 改变、PID 1 复用、运行/停止意图、配置/认证与 Mock 协议恢复，以及 SIGKILL 后拒绝接管通过",
    );
} finally {
    // 只有确认容器已停止并移除，才删除专用 bind mount。
    compose("down");
    // Linux runner 与容器 UID 可以不同；只清理本脚本独占的临时 bind mount。
    dataNode(
        `import fs from 'node:fs';
        for(const entry of fs.readdirSync('/data')) fs.rmSync('/data/'+entry,{recursive:true,force:true});`,
        false,
    );
    fs.rmSync(root, { recursive: true, force: true });
}
