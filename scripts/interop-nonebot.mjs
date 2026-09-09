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
const PYTHON = process.env.ONEBOTS_INTEROP_PYTHON || "python3";
const TOKEN = "onebots-nonebot-interop-token";
const EXPECTED_NONEBOT_VERSION = "2.5.0";
const EXPECTED_ADAPTER_VERSION = "2.4.6";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-nonebot-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const children = [];

try {
    await assertPythonDependencies();
    const [nonebotPort, gatewayPort] = await Promise.all([allocatePort(), allocatePort()]);

    const nonebot = startProcess(
        PYTHON,
        [path.join(ROOT, "interop/nonebot/app.py")],
        {
            ONEBOTS_INTEROP_NONEBOT_PORT: String(nonebotPort),
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "NoneBot",
    );
    children.push(nonebot);
    await waitForPort(nonebotPort, nonebot, 15_000);
    await assertWrongTokenRejected(nonebotPort);

    const gateway = await startManagedGateway({
        root: ROOT,
        workspace: temporaryDirectory,
        gatewayPort,
        configSource: renderGatewayConfig(gatewayPort, nonebotPort),
        protocolPackage: "onebot-v11",
        protocolConfig: "onebot.v11",
        framework: "nonebot",
        children,
    });

    const evidence = await waitForEvidence(evidencePath, [nonebot, gateway], 20_000);
    assertEvidence(evidence);
    await verifyFrameworkSend(gateway, evidence, {
        gatewayPort,
        framework: "nonebot",
        protocol: "onebot.v11",
        token: TOKEN,
    });
    process.stdout.write(
        `${JSON.stringify({
            ok: true,
            framework: "nonebot",
            frameworkVersion: evidence.frameworkVersion,
            adapterVersion: evidence.adapterVersion,
            protocol: "onebot.v11",
            transport: "reverse-websocket",
            checks: [
                "auth-rejection",
                "handshake",
                "message",
                "get_login_info",
                "send_private_msg",
            ],
        })}\n`,
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
    const script = [
        "from importlib.metadata import version",
        `assert version('nonebot2') == '${EXPECTED_NONEBOT_VERSION}'`,
        `assert version('nonebot-adapter-onebot') == '${EXPECTED_ADAPTER_VERSION}'`,
    ].join(";");
    const probe = startProcess(PYTHON, ["-c", script], {}, "Python dependency probe");
    const code = await probe.exit;
    if (code !== 0) {
        throw new Error(
            `NoneBot 互操作依赖缺失或版本不符。请运行 ${PYTHON} -m pip install -r interop/nonebot/requirements.txt\n${probe.logs()}`,
        );
    }
}

function renderGatewayConfig(gatewayPort, nonebotPort) {
    return `port: ${gatewayPort}
log_level: error
access_token: onebots-management-interop-token
mock.interop:
  account_id: interop
  latency: 0
  auto_events: true
  event_interval: 100
  auto_event_types: [private_message]
  onebot.v11:
    use_http: false
    use_ws: false
    access_token: ${TOKEN}
    ws_reverse:
      - ws://127.0.0.1:${nonebotPort}/onebot/v11/ws
`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(
            `ws://127.0.0.1:${port}/onebot/v11/ws?access_token=wrong-token`,
            {
                headers: {
                    "X-Self-ID": "interop",
                    "X-Client-Role": "Universal",
                    "User-Agent": "OneBot/11",
                },
            },
        );
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("NoneBot 未在限定时间内拒绝错误 token"));
        }, 3_000);
        socket.once("open", () => {
            clearTimeout(timer);
            socket.terminate();
            reject(new Error("NoneBot 接受了错误 token"));
        });
        socket.once("unexpected-response", (_request, response) => {
            clearTimeout(timer);
            response.resume();
            resolve();
        });
        socket.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once("error", () => {
            // HTTP 拒绝可能同时触发 unexpected-response 与 error；终态由前两者判定。
        });
    });
}

function assertEvidence(evidence) {
    const failures = [];
    if (evidence.framework !== "nonebot") failures.push("framework");
    if (evidence.frameworkVersion !== EXPECTED_NONEBOT_VERSION) failures.push("frameworkVersion");
    if (evidence.adapterVersion !== EXPECTED_ADAPTER_VERSION) failures.push("adapterVersion");
    if (evidence.event?.postType !== "message") failures.push("event.postType");
    if (evidence.event?.messageType !== "private") failures.push("event.messageType");
    if (!evidence.event?.plainText?.includes("测试消息")) failures.push("event.plainText");
    if (!evidence.event?.messageId) failures.push("event.messageId");
    if (!evidence.login?.user_id) failures.push("login.user_id");
    if (!evidence.send?.message_id) failures.push("send.message_id");
    if (failures.length) {
        throw new Error(
            `NoneBot 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
    }
}
