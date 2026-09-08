// 在测试容器内执行；不随运行镜像分发，不输出任何管理令牌或配对码。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLocalControlClient } from "/app/packages/onebots/lib/client/local-control.js";
import { ControlClient, createHttpControlTransport } from "/app/packages/core/lib/control.js";

const local = createLocalControlClient("/data");
let initial;
for (let attempt = 0; attempt < 100; attempt++) {
    try {
        initial = await local.status();
        if (process.env.CONTROL_VERIFY_RESTART || initial.gateway.actual === "running") break;
    } catch {
        // 容器进程与管理 socket 的创建异步完成；这里只做有界就绪等待。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(initial, "管理服务未在截止时间内就绪");
assert.equal((await fetch("http://127.0.0.1:6727/")).status, 200);
if (process.env.CONTROL_VERIFY_RESTART) {
    assert.equal(initial.gateway.desired, "stopped");
    assert.equal(initial.gateway.actual, "stopped");
    console.log("容器重启保留网关停止意图：通过");
} else {
    assert.equal(initial.gateway.actual, "running");
    assert.equal(fs.readFileSync("/data/config.yaml", "utf8").includes("access_token"), false);
    let token = "";
    const web = new ControlClient(createHttpControlTransport("http://127.0.0.1:6727", () => token));
    token = (await web.pair((await local.bootstrap()).code)).token;
    assert.equal((await web.status()).manager.id, initial.manager.id);
    assert.equal((await web.gateway("stop")).status, "succeeded");
    assert.equal((await fetch("http://127.0.0.1:6727/")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:6727/ready")).status, 200);
    assert.equal((await fetch("http://127.0.0.1:6727/no-protocol")).status, 503);
    assert.equal((await web.status()).manager.id, initial.manager.id);
    assert.equal((await web.gateway("start")).status, "succeeded");
    assert.notEqual((await web.status()).gateway.instance.id, initial.gateway.instance.id);
    assert.equal((await web.gateway("restart")).status, "succeeded");
    assert.equal((await web.gateway("stop")).status, "succeeded");
    console.log("Docker 空卷、Web 配对、网关启停及管理端持续在线：通过");
}
