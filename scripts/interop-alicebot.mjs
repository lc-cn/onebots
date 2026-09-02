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
const TOKEN = "onebots-alicebot-interop-token";
const PYTHON =
    process.env.ONEBOTS_INTEROP_ALICEBOT_PYTHON ??
    path.join(ROOT, "interop/alicebot/.venv/bin/python");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-alicebot-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const configPath = path.join(temporaryDirectory, "config.yaml");
const children = [];

try {
    await assertPythonDependencies();
    prepareWorkspacePlugins();
    const [frameworkPort, gatewayPort] = await Promise.all([allocatePort(), allocatePort()]);
    fs.writeFileSync(configPath, renderConfig(gatewayPort, frameworkPort), "utf8");
    const alicebot = startProcess(
        PYTHON,
        [path.join(ROOT, "interop/alicebot/app.py")],
        {
            ALICEBOT_DEV: "1",
            ONEBOTS_INTEROP_FRAMEWORK_PORT: String(frameworkPort),
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "AliceBot",
        path.join(ROOT, "interop/alicebot"),
    );
    children.push(alicebot);
    await waitForPort(frameworkPort, alicebot, 20_000);
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
    const evidence = await waitForEvidence(evidencePath, [alicebot, gateway], 30_000);
    assertEvidence(evidence);
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "alicebot", frameworkVersion: "0.11.0", adapterVersion: "0.11.0", protocol: "onebot.v11", transport: "reverse-websocket", checks: ["auth-rejection", "handshake", "private-message", "get_login_info", "send_private_msg"] })}\n`,
    );
} finally {
    await Promise.all(children.reverse().map(stopProcess));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function assertPythonDependencies() {
    if (!fs.existsSync(PYTHON)) {
        throw new Error("AliceBot 互操作虚拟环境缺失，请按固定 requirements 创建 .venv");
    }
    const probe = startProcess(
        PYTHON,
        [
            "-c",
            "from importlib.metadata import version; assert version('alicebot') == '0.11.0'; assert version('alicebot-adapter-cqhttp') == '0.11.0'",
        ],
        {},
        "AliceBot dependency probe",
        path.join(ROOT, "interop/alicebot"),
    );
    if ((await probe.exit) !== 0) {
        throw new Error(`AliceBot 互操作依赖版本不符\n${probe.logs()}`);
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
}

function renderConfig(gatewayPort, frameworkPort) {
    return `port: ${gatewayPort}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  onebot.v11:\n    use_http: false\n    use_ws: false\n    access_token: ${TOKEN}\n    ws_reverse:\n      - ws://127.0.0.1:${frameworkPort}/cqhttp/ws\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/cqhttp/ws?access_token=wrong`);
        const timer = setTimeout(() => reject(new Error("AliceBot 未拒绝错误 token")), 3_000);
        socket.once("open", () => reject(new Error("AliceBot 接受了错误 token")));
        socket.once("unexpected-response", (_request, response) => {
            clearTimeout(timer);
            response.resume();
            resolve();
        });
        socket.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once("error", () => undefined);
    });
}

function assertEvidence(evidence) {
    const failures = [];
    if (evidence.framework !== "alicebot") failures.push("framework");
    if (evidence.frameworkVersion !== "0.11.0") failures.push("frameworkVersion");
    if (evidence.adapterVersion !== "0.11.0") failures.push("adapterVersion");
    if (evidence.event?.messageType !== "private") failures.push("event.messageType");
    if (!String(evidence.event?.plainText).includes("测试消息")) failures.push("event.plainText");
    if (!evidence.login?.user_id) failures.push("login.user_id");
    if (!evidence.send?.message_id) failures.push("send.message_id");
    if (failures.length) {
        throw new Error(
            `AliceBot 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
    }
}
