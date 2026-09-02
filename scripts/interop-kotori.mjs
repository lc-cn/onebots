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
const TOKEN = "onebots-kotori-interop-token";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-kotori-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const configPath = path.join(temporaryDirectory, "config.yaml");
const children = [];

try {
    assertDependencies();
    prepareWorkspacePlugins();
    const [frameworkPort, gatewayPort] = await Promise.all([allocatePort(), allocatePort()]);
    fs.writeFileSync(configPath, renderConfig(gatewayPort, frameworkPort), "utf8");
    const kotori = startProcess(
        process.execPath,
        [path.join(ROOT, "interop/kotori/app.cjs")],
        {
            ONEBOTS_INTEROP_FRAMEWORK_PORT: String(frameworkPort),
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "Kotori",
        path.join(ROOT, "interop/kotori"),
    );
    children.push(kotori);
    await waitForPort(frameworkPort, kotori, 15_000);
    await assertWrongTokenRejected(frameworkPort);

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
        ],
        {},
        "OneBots",
        temporaryDirectory,
    );
    children.push(gateway);
    await waitForPort(gatewayPort, gateway, 15_000);
    const evidence = await waitForEvidence(evidencePath, [kotori, gateway], 30_000);
    assertEvidence(evidence);
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "kotori", frameworkVersion: "1.7.5", adapterVersion: "2.1.2", protocol: "onebot.v11", transport: "reverse-websocket", checks: ["auth-rejection", "handshake", "private-message", "get_login_info", "send_private_msg"] })}\n`,
    );
} finally {
    await Promise.all(children.reverse().map(stopProcess));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function assertDependencies() {
    const packageJson = JSON.parse(
        fs.readFileSync(
            path.join(
                ROOT,
                "interop/kotori/node_modules/@kotori-bot/kotori-plugin-adapter-onebot/package.json",
            ),
            "utf8",
        ),
    );
    if (packageJson.version !== "2.1.2") throw new Error("Kotori adapter 固定版本不符");
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
}

function renderConfig(gatewayPort, frameworkPort) {
    return `port: ${gatewayPort}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  onebot.v11:\n    use_http: false\n    use_ws: false\n    access_token: ${TOKEN}\n    ws_reverse:\n      - ws://127.0.0.1:${frameworkPort}/adapter/onebots\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/adapter/onebots?access_token=wrong`);
        const timer = setTimeout(() => reject(new Error("Kotori 未拒绝错误 token")), 3_000);
        socket.once("close", code => {
            clearTimeout(timer);
            if (code !== 1008) reject(new Error(`Kotori 错误 token 关闭码异常：${code}`));
            else resolve();
        });
        socket.once("error", reject);
    });
}

function assertEvidence(evidence) {
    const failures = [];
    if (evidence.framework !== "kotori") failures.push("framework");
    if (evidence.frameworkVersion !== "1.7.5") failures.push("frameworkVersion");
    if (evidence.adapterVersion !== "2.1.2") failures.push("adapterVersion");
    if (!String(evidence.event?.plainText).includes("测试消息")) failures.push("event.plainText");
    if (!evidence.login?.userId) failures.push("login.userId");
    if (!evidence.send?.messageId) failures.push("send.messageId");
    if (failures.length) {
        throw new Error(
            `Kotori 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
    }
}
