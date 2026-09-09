// 在测试容器内执行；不随运行镜像分发，不输出任何管理令牌或配对码。
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ControlClient, createHttpControlTransport } from "/app/packages/core/lib/control.js";

const CLI = "/app/packages/onebots/lib/bin.js";
const TOKEN_PROBE = "/tmp/onebots-control-acceptance-token";

function cli(...args) {
    const result = spawnSync(process.execPath, [CLI, ...args, "--data-dir", "/data"], {
        cwd: "/app/development",
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(
        result.status,
        0,
        `构建产物 CLI 执行失败：onebots ${args.join(" ")}（exit ${String(result.status)}）`,
    );
    return result.stdout.trim();
}

function cliJson(...args) {
    const output = cli(...args);
    try {
        return JSON.parse(output);
    } catch {
        assert.fail(`构建产物 CLI 未输出合法 JSON：onebots ${args.join(" ")}`);
    }
}

function assertSameControlState(cliStatus, httpStatus) {
    assert.equal(cliStatus.manager.id, httpStatus.manager.id);
    assert.equal(cliStatus.gateway.desired, httpStatus.gateway.desired);
    assert.equal(cliStatus.gateway.actual, httpStatus.gateway.actual);
    assert.equal(cliStatus.gateway.instance?.id, httpStatus.gateway.instance?.id);
}

function assertDistinctOperations(operations) {
    for (const operation of operations)
        assert.equal(typeof operation.id === "string" && operation.id.length > 0, true);
    assert.equal(new Set(operations.map(operation => operation.id)).size, operations.length);
}

let initial;
for (let attempt = 0; attempt < 100; attempt++) {
    try {
        initial = cliJson("control", "status");
        if (process.env.CONTROL_VERIFY_RESTART || initial.gateway.actual === "running") break;
    } catch {
        // 容器进程与管理 socket 的创建异步完成；这里只通过真实 CLI 做有界就绪等待。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(initial, "管理服务未在截止时间内就绪");
assert.equal((await fetch("http://127.0.0.1:6727/")).status, 200);
if (process.env.CONTROL_VERIFY_RESTART) {
    assert.equal(initial.gateway.desired, "stopped");
    assert.equal(initial.gateway.actual, "stopped");
    const previousToken = fs.readFileSync(TOKEN_PROBE, "utf8");
    const previousWeb = new ControlClient(
        createHttpControlTransport("http://127.0.0.1:6727", () => previousToken),
    );
    assertSameControlState(initial, await previousWeb.status());

    let nextToken = "";
    const nextWeb = new ControlClient(
        createHttpControlTransport("http://127.0.0.1:6727", () => nextToken),
    );
    nextToken = (await nextWeb.pair(cli("auth", "device"))).token;
    assert.notEqual(nextToken, previousToken);
    assertSameControlState(initial, await nextWeb.status());
    assertSameControlState(initial, await previousWeb.status());
    fs.rmSync(TOKEN_PROBE);
    console.log("容器重启后 CLI 与 HTTP 保留相同网关停止状态：通过");
} else {
    assert.equal(initial.gateway.actual, "running");
    assert.equal(fs.readFileSync("/data/config.yaml", "utf8").includes("access_token"), false);
    let token = "";
    const web = new ControlClient(createHttpControlTransport("http://127.0.0.1:6727", () => token));
    token = (await web.pair(cli("auth", "bootstrap"))).token;
    assertSameControlState(initial, await web.status());

    const stopped = cliJson("control", "stop");
    assert.equal(stopped.status, "succeeded");
    assertSameControlState(cliJson("control", "status"), await web.status());
    assert.equal((await fetch("http://127.0.0.1:6727/")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:6727/ready")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:6727/no-protocol")).status, 503);

    const startedOperation = cliJson("control", "start");
    assert.equal(startedOperation.status, "succeeded");
    const started = await web.status();
    assert.notEqual(started.gateway.instance.id, initial.gateway.instance.id);
    assertSameControlState(cliJson("control", "status"), started);

    const restarted = cliJson("control", "restart");
    assert.equal(restarted.status, "succeeded");
    assertSameControlState(cliJson("control", "status"), await web.status());
    const stoppedAgain = cliJson("control", "stop");
    assert.equal(stoppedAgain.status, "succeeded");
    assertSameControlState(cliJson("control", "status"), await web.status());
    assertDistinctOperations([stopped, startedOperation, restarted, stoppedAgain]);
    fs.writeFileSync(TOKEN_PROBE, token, { mode: 0o600 });
    console.log("Docker 空卷、真实 CLI 配对/启停及 HTTP 状态对账：通过");
}
