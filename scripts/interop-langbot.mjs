import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
    allocatePort,
    startManagedGateway,
    startProcess,
    stopManagedGateway,
    stopProcess,
    waitForEvidence,
    verifyFrameworkSend,
    waitForPort,
} from "./interop-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "onebots-langbot-interop-token";
const PYTHON =
    process.env.ONEBOTS_INTEROP_LANGBOT_PYTHON ??
    path.join(ROOT, "interop/langbot/.venv/bin/python");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-langbot-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const children = [];

try {
    await assertPythonDependencies();
    const [frameworkPort, gatewayPort] = await Promise.all([allocatePort(), allocatePort()]);
    const langbot = startProcess(
        PYTHON,
        [path.join(ROOT, "interop/langbot/app.py")],
        {
            ONEBOTS_INTEROP_FRAMEWORK_PORT: String(frameworkPort),
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "LangBot",
        path.join(ROOT, "interop/langbot"),
    );
    children.push(langbot);
    await waitForPort(frameworkPort, langbot, 20_000);
    await assertWrongTokenRejected(frameworkPort);

    const gateway = await startManagedGateway({
        root: ROOT,
        workspace: temporaryDirectory,
        gatewayPort,
        configSource: renderConfig(gatewayPort, frameworkPort),
        protocolPackage: "onebot-v11",
        protocolConfig: "onebot.v11",
        framework: "langbot",
        children,
    });
    const evidence = await waitForEvidence(evidencePath, [langbot, gateway], 30_000);
    assertEvidence(evidence);
    await verifyFrameworkSend(gateway, evidence, {
        gatewayPort,
        framework: "langbot",
        protocol: "onebot.v11",
        token: TOKEN,
    });
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "langbot", frameworkVersion: "4.10.9", adapterVersion: "built-in", protocol: "onebot.v11", transport: "reverse-websocket", checks: ["auth-rejection", "handshake", "private-message", "get_login_info", "send_private_msg"] })}\n`,
    );
} finally {
    try {
        await stopManagedGateway(children.find(item => item.control));
    } finally {
        await Promise.all(children.reverse().map(stopProcess));
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function assertPythonDependencies() {
    if (!fs.existsSync(PYTHON))
        throw new Error("LangBot 互操作虚拟环境缺失，请按固定 requirements 创建 .venv");
    const probe = startProcess(
        PYTHON,
        [
            "-c",
            "from importlib.metadata import version; assert version('langbot') == '4.10.9'; assert version('langbot-plugin') == '0.5.6'; assert version('aiocqhttp') == '1.4.4'",
        ],
        {},
        "LangBot dependency probe",
        path.join(ROOT, "interop/langbot"),
    );
    if ((await probe.exit) !== 0) throw new Error(`LangBot 互操作依赖版本不符\n${probe.logs()}`);
}

function renderConfig(gatewayPort, frameworkPort) {
    return `port: ${gatewayPort}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  onebot.v11:\n    use_http: false\n    use_ws: false\n    access_token: ${TOKEN}\n    ws_reverse:\n      - ws://127.0.0.1:${frameworkPort}/ws\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?access_token=wrong`, {
            headers: { "X-Self-ID": "interop", "X-Client-Role": "Universal" },
        });
        const timer = setTimeout(() => reject(new Error("LangBot 未拒绝错误 token")), 3_000);
        socket.once("open", () => reject(new Error("LangBot 接受了错误 token")));
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
    if (evidence.framework !== "langbot") failures.push("framework");
    if (evidence.frameworkVersion !== "4.10.9") failures.push("frameworkVersion");
    if (evidence.event?.messageType !== "private") failures.push("event.messageType");
    if (!String(evidence.event?.plainText).includes("测试消息")) failures.push("event.plainText");
    if (!evidence.login?.user_id) failures.push("login.user_id");
    if (!evidence.send?.message_id) failures.push("send.message_id");
    if (failures.length)
        throw new Error(
            `LangBot 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
}
