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
const RUNTIME = path.resolve(process.env.ONEBOTS_INTEROP_KARIN_RUNTIME ?? "interop/karin");
const TOKEN = "onebots-karin-interop-token";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-karin-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const children = [];

try {
    assertRuntime();
    const gatewayPort = await allocatePort();
    const gateway = await startManagedGateway({
        root: ROOT,
        workspace: temporaryDirectory,
        gatewayPort,
        configSource: renderConfig(gatewayPort),
        protocolPackage: "milky-v1",
        protocolConfig: "milky.v1",
        framework: "karin",
        children,
    });
    await assertWrongTokenRejected(gatewayPort);

    const karin = startProcess(
        process.execPath,
        [path.join(ROOT, "interop/karin/app.mjs")],
        {
            ONEBOTS_INTEROP_KARIN_RUNTIME: RUNTIME,
            ONEBOTS_INTEROP_ENDPOINT: `http://127.0.0.1:${gatewayPort}/mock/interop/milky/v1`,
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "Karin",
        temporaryDirectory,
    );
    children.push(karin);
    const evidence = await waitForEvidence(evidencePath, [gateway, karin], 25_000);
    assertEvidence(evidence);
    await verifyFrameworkSend(gateway, evidence, {
        gatewayPort,
        framework: "karin",
        protocol: "milky.v1",
        token: TOKEN,
    });
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "karin", frameworkVersion: evidence.frameworkVersion, adapterVersion: evidence.adapterVersion, protocol: "milky.v1", transport: "websocket", checks: ["auth-rejection", "handshake", "private-message", "get_login_info", "get_impl_info", "send_private_message"] })}\n`,
    );
} finally {
    try {
        await stopManagedGateway(children.find(item => item.control));
    } finally {
        await Promise.all(children.reverse().map(stopProcess));
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function assertRuntime() {
    for (const file of [
        "node_modules/node-karin/package.json",
        "node_modules/@karinjs/plugin-adapter-milky/package.json",
    ]) {
        if (!fs.existsSync(path.join(RUNTIME, file)))
            throw new Error(`Karin 互操作依赖缺失：${file}`);
    }
}

function renderConfig(port) {
    return `port: ${port}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  milky.v1:\n    use_http: true\n    use_ws: true\n    access_token: ${TOKEN}\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/mock/interop/milky/v1/event`, {
            headers: { authorization: "Bearer wrong-token" },
        });
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("OneBots Milky 未拒绝错误 token"));
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
    if (evidence.framework !== "karin") failures.push("framework");
    if (evidence.frameworkVersion !== "1.15.3") failures.push("frameworkVersion");
    if (evidence.adapterVersion !== "1.3.3") failures.push("adapterVersion");
    if (evidence.connection?.standard !== "milky") failures.push("connection.standard");
    if (evidence.connection?.communication !== "webSocketClient")
        failures.push("connection.communication");
    if (evidence.event?.event !== "message" || evidence.event?.subEvent !== "friend")
        failures.push("event.type");
    if (!String(evidence.event?.rawMessage).includes("测试消息")) failures.push("event.rawMessage");
    if (!evidence.login?.selfId) failures.push("login.selfId");
    if (!evidence.send?.messageId) failures.push("send.messageId");
    if (failures.length)
        throw new Error(
            `Karin 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
}
