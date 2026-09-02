import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
    allocatePort,
    startProcess,
    stopProcess,
    waitForEvidence,
    waitForPort,
} from "./interop-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = path.resolve(process.env.ONEBOTS_INTEROP_ZHIN_RUNTIME ?? "interop/zhin");
const TOKEN = "onebots-zhin-interop-token";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-zhin-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const configPath = path.join(temporaryDirectory, "config.yaml");
const children = [];

try {
    assertRuntime();
    prepareWorkspacePlugins();
    const gatewayPort = await allocatePort();
    fs.writeFileSync(configPath, renderConfig(gatewayPort), "utf8");
    const gateway = startProcess(
        process.execPath,
        [
            path.join(ROOT, "packages/onebots/lib/bin.js"),
            "--service-runtime",
            "run",
            "-c",
            configPath,
            "-r",
            "mock",
            "-p",
            "onebot-v11",
            "-t",
            "zhin",
        ],
        {},
        "OneBots",
        temporaryDirectory,
    );
    children.push(gateway);
    await waitForPort(gatewayPort, gateway, 15_000);
    await assertWrongTokenRejected(gatewayPort);

    const zhin = startProcess(
        process.execPath,
        [path.join(ROOT, "interop/zhin/app.mjs")],
        {
            ONEBOTS_INTEROP_ZHIN_RUNTIME: RUNTIME,
            ONEBOTS_INTEROP_ENDPOINT: `ws://127.0.0.1:${gatewayPort}/mock/interop/onebot/v11`,
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "Zhin",
        ROOT,
    );
    children.push(zhin);
    const evidence = await waitForEvidence(evidencePath, [gateway, zhin], 20_000);
    assertEvidence(evidence);
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "zhin", frameworkVersion: evidence.frameworkVersion, adapterVersion: evidence.adapterVersion, protocol: "onebot.v11", transport: "websocket", checks: ["auth-rejection", "handshake", "private-message", "get_login_info", "send_private_msg"] })}\n`,
    );
} finally {
    await Promise.all(children.reverse().map(stopProcess));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function assertRuntime() {
    for (const file of [
        "node_modules/zhin.js/package.json",
        "node_modules/@zhin.js/adapter-onebot11/package.json",
    ]) {
        if (!fs.existsSync(path.join(RUNTIME, file)))
            throw new Error(`Zhin 互操作依赖缺失：${file}`);
    }
}

function prepareWorkspacePlugins() {
    const scope = path.join(temporaryDirectory, "node_modules", "@onebots");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(
        path.join(ROOT, "adapters/adapter-mock"),
        path.join(scope, "adapter-mock"),
        "dir",
    );
    fs.symlinkSync(
        path.join(ROOT, "protocols/onebot-v11/protocol"),
        path.join(scope, "protocol-onebot-v11"),
        "dir",
    );
    fs.symlinkSync(
        path.join(ROOT, "applications/zhin"),
        path.join(scope, "application-zhin"),
        "dir",
    );
}

function renderConfig(port) {
    return `port: ${port}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  onebot.v11:\n    use_http: false\n    use_ws: true\n    access_token: ${TOKEN}\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(
            `ws://127.0.0.1:${port}/mock/interop/onebot/v11?access_token=wrong-token`,
        );
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("OneBots 未拒绝错误 token"));
        }, 3_000);
        socket.once("close", code => {
            clearTimeout(timer);
            code === 1008 ? resolve() : reject(new Error(`错误 token 关闭码异常：${code}`));
        });
        socket.once("error", () => undefined);
    });
}

function assertEvidence(evidence) {
    const failures = [];
    if (evidence.framework !== "zhin") failures.push("framework");
    if (evidence.frameworkVersion !== "6.0.15") failures.push("frameworkVersion");
    if (evidence.adapterVersion !== "7.0.8") failures.push("adapterVersion");
    if (evidence.event?.conversation?.kind !== "private") failures.push("event.conversation.kind");
    if (!String(evidence.event?.content).includes("测试消息")) failures.push("event.content");
    if (evidence.login?.status !== "ok" || !evidence.login?.data?.user_id) {
        failures.push("login.data.user_id");
    }
    if (!evidence.send?.message_id) failures.push("send.message_id");
    if (failures.length)
        throw new Error(
            `Zhin 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
}
