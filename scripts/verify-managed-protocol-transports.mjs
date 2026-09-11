import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    allocatePort,
    startManagedGateway,
    startProcess,
    stopManagedGateway,
    stopProcess,
} from "./interop-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "onebots-managed-protocol-ci";
const WEBHOOK_SECRET = "onebots-managed-webhook-secret";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-protocol-ci-"));
const children = [];

const suites = [
    "__tests__/onebot/v11/http/api.spec.js",
    "__tests__/onebot/v11/http/auth.spec.js",
    "__tests__/onebot/v11/websocket/auth.spec.js",
    "__tests__/onebot/v11/websocket/connection.spec.js",
    "__tests__/onebot/v11/webhook/auth.spec.js",
    "__tests__/onebot/v11/webhook/http-reverse.spec.js",
    "__tests__/onebot/v11/websocket/ws-reverse-auth.spec.js",
    "__tests__/onebot/v11/websocket/ws-reverse.spec.js",
    "__tests__/onebot/v12/http/api.spec.js",
    "__tests__/onebot/v12/webhook/headers.spec.js",
    "__tests__/onebot/v12/websocket/connection.spec.js",
    "__tests__/onebot/v12/websocket/headers.spec.js",
    "__tests__/onebot/v12/websocket/ws-reverse.spec.js",
    "__tests__/satori/v1/http/api.spec.js",
    "__tests__/satori/v1/http/auth.spec.js",
    "__tests__/satori/v1/websocket/event.spec.js",
    "__tests__/milky/v1/http/api.spec.js",
    "__tests__/milky/v1/http/auth.spec.js",
    "__tests__/milky/v1/sse/event.spec.js",
    "__tests__/milky/v1/webhook/event.spec.js",
    "__tests__/milky/v1/websocket/event.spec.js",
];
assert.deepEqual(
    [...suites].sort(),
    discoverProtocolSuites(),
    "受管回归必须覆盖根 __tests__ 中全部现有协议套件",
);

try {
    const gatewayPort = await allocatePort();
    const gateway = await startManagedGateway({
        root: ROOT,
        workspace: temporaryDirectory,
        gatewayPort,
        configSource: renderConfig(gatewayPort),
        protocolPackage: ["onebot-v11", "onebot-v12", "satori-v1", "milky-v1", "mcp-v1"],
        protocolConfig: ["onebot.v11", "onebot.v12", "satori.v1", "milky.v1", "mcp.v1"],
        children,
    });
    const initialStatus = await gateway.control.status();
    const initialInstanceId = initialStatus.gateway.instance?.id;
    const initialGenerationId = initialStatus.generation.active?.id;
    assert.ok(initialInstanceId, "受管网关启动后必须有实例身份");
    assert.ok(initialGenerationId, "受管网关启动后必须有激活代际");

    await assertProtocolEndpoints(gatewayPort);
    await assertManagedMcp(gateway.control);

    const tests = startProcess(
        process.execPath,
        [
            path.join(ROOT, "node_modules/vitest/vitest.mjs"),
            "run",
            ...suites,
            "--maxWorkers=1",
            "--fileParallelism=false",
        ],
        {
            ONEBOTS_URL: `http://127.0.0.1:${gatewayPort}`,
            ONEBOTS_WS_URL: `ws://127.0.0.1:${gatewayPort}`,
            PLATFORM: "mock",
            ACCOUNT_ID: "interop",
            ACCESS_TOKEN: TOKEN,
            WEBHOOK_SECRET,
            WEBHOOK_PORT: "8899",
            ONEBOTS_REQUIRE_SERVER: "1",
        },
        "协议传输回归",
        ROOT,
    );
    children.push(tests);
    const code = await tests.exit;
    if (code !== 0) throw new Error(`协议传输回归失败（exit ${code}）\n${tests.logs()}`);

    const status = await gateway.control.status();
    assert.equal(status.gateway.actual, "running", "传输套件结束时受管网关必须仍在运行");
    assert.equal(
        status.gateway.instance?.id,
        initialInstanceId,
        "传输套件期间受管网关不得重启或替换实例",
    );
    assert.equal(
        status.generation.active?.id,
        initialGenerationId,
        "传输套件期间受管网关不得切换运行代际",
    );
    process.stdout.write(
        `${JSON.stringify({
            ok: true,
            fixture: "managed-mock",
            protocols: ["onebot-v11", "onebot-v12", "satori-v1", "milky-v1", "mcp-v1"],
            suites: suites.length,
        })}\n`,
    );
} finally {
    try {
        await stopManagedGateway(children.find(item => item.control));
    } finally {
        await Promise.all(children.reverse().map(stopProcess));
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function renderConfig(port) {
    return `port: ${port}
log_level: error
mock.interop:
  account_id: interop
  latency: 0
  auto_events: true
  event_interval: 100
  auto_event_types: [private_message, group_message, friend_request, heartbeat]
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ${TOKEN}
    secret: ${WEBHOOK_SECRET}
    heartbeat_interval: 100
    http_reverse:
      - http://127.0.0.1:18080
      - http://127.0.0.1:18083
    ws_reverse:
      - ws://127.0.0.1:18081?access_token=${TOKEN}
      - ws://127.0.0.1:18084?access_token=${TOKEN}
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ${TOKEN}
    heartbeat_interval: 100
    http_webhook:
      - http://127.0.0.1:18085
    ws_reverse:
      - ws://127.0.0.1:18082
      - ws://127.0.0.1:18086
  satori.v1:
    use_http: true
    use_ws: true
    token: ${TOKEN}
  milky.v1:
    use_http: true
    use_ws: true
    access_token: ${TOKEN}
    http_reverse:
      - url: http://127.0.0.1:8899
  mcp.v1: {}
`;
}

async function assertProtocolEndpoints(port) {
    const endpoints = [
        ["onebot-v11", "/mock/interop/onebot/v11/get_login_info", {}],
        ["onebot-v12", "/mock/interop/onebot/v12/get_version", {}],
        ["satori-v1", "/mock/interop/satori/v1/login.get", {}],
        ["milky-v1", "/mock/interop/milky/v1/api/get_login_info", {}],
    ];
    for (const [name, route, body] of endpoints) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        });
        assert.equal(response.status, 200, `${name} HTTP endpoint`);
        const result = await response.json();
        assert.notEqual(result?.status, "failed", `${name} HTTP response`);
    }
}

async function assertManagedMcp(client) {
    const session = await client.openMcp("mock/interop");
    try {
        const initialized = await client.exchangeMcp(
            session.id,
            JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "managed-protocol-ci", version: "1" },
                },
            }),
        );
        assert.equal(JSON.parse(initialized.message).result.serverInfo.name, "onebots-mcp");
        const ping = await client.exchangeMcp(
            session.id,
            '{"jsonrpc":"2.0","id":2,"method":"ping"}',
        );
        assert.deepEqual(JSON.parse(ping.message), { jsonrpc: "2.0", id: 2, result: {} });
    } finally {
        await client.closeMcp(session.id);
    }
}

function discoverProtocolSuites() {
    return execFileSync(
        "git",
        [
            "ls-files",
            "__tests__/onebot/**/*.spec.js",
            "__tests__/satori/**/*.spec.js",
            "__tests__/milky/**/*.spec.js",
        ],
        { cwd: ROOT, encoding: "utf8" },
    )
        .split("\n")
        .filter(Boolean)
        .sort();
}
