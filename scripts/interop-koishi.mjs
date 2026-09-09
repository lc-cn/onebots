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
const RUNTIME = path.resolve(process.env.ONEBOTS_INTEROP_KOISHI_RUNTIME ?? "interop/koishi");
const TOKEN = "onebots-koishi-interop-token";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-koishi-interop-"));
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
        protocolPackage: "satori-v1",
        protocolConfig: "satori.v1",
        framework: "koishi",
        children,
    });
    await assertWrongTokenRejected(gatewayPort);

    const koishi = startProcess(
        process.execPath,
        [path.join(ROOT, "interop/koishi/app.mjs")],
        {
            ONEBOTS_INTEROP_ENDPOINT: `http://127.0.0.1:${gatewayPort}/mock/interop/satori`,
            ONEBOTS_INTEROP_TOKEN: TOKEN,
            ONEBOTS_INTEROP_EVIDENCE: evidencePath,
        },
        "Koishi",
        ROOT,
    );
    children.push(koishi);
    const evidence = await waitForEvidence(evidencePath, [gateway, koishi], 25_000);
    assertEvidence(evidence);
    await verifyFrameworkSend(gateway, evidence, {
        gatewayPort,
        framework: "koishi",
        protocol: "satori.v1",
        token: TOKEN,
    });
    process.stdout.write(
        `${JSON.stringify({ ok: true, framework: "koishi", frameworkVersion: evidence.frameworkVersion, adapterVersion: evidence.adapterVersion, protocol: "satori.v1", transport: "websocket", checks: ["auth-rejection", "handshake", "private-message", "message.create"] })}\n`,
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
        "node_modules/koishi/package.json",
        "node_modules/@koishijs/plugin-adapter-satori/package.json",
    ]) {
        if (!fs.existsSync(path.join(RUNTIME, file)))
            throw new Error(`Koishi 互操作依赖缺失：${file}`);
    }
}

function renderConfig(port) {
    return `port: ${port}\nlog_level: error\naccess_token: management-token\nmock.interop:\n  account_id: interop\n  latency: 0\n  auto_events: true\n  event_interval: 100\n  auto_event_types: [private_message]\n  satori.v1:\n    use_http: true\n    use_ws: true\n    token: ${TOKEN}\n`;
}

function assertWrongTokenRejected(port) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/mock/interop/satori/v1/events`);
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("OneBots Satori 未拒绝错误 token"));
        }, 3_000);
        socket.once("open", () => {
            socket.send(JSON.stringify({ op: 3, body: { token: "wrong-token" } }));
        });
        socket.once("close", code => {
            clearTimeout(timer);
            code === 1008 ? resolve() : reject(new Error(`错误 token 关闭码异常：${code}`));
        });
        socket.once("error", () => undefined);
    });
}

function assertEvidence(evidence) {
    const failures = [];
    if (evidence.framework !== "koishi") failures.push("framework");
    if (evidence.frameworkVersion !== "4.18.6") failures.push("frameworkVersion");
    if (evidence.adapterVersion !== "1.5.1") failures.push("adapterVersion");
    if (evidence.bot?.platform !== "mock" || !evidence.bot?.selfId) failures.push("bot");
    if (evidence.event?.type !== "message-created" || evidence.event?.platform !== "mock")
        failures.push("event.type");
    if (!String(evidence.event?.content).includes("测试消息")) failures.push("event.content");
    if (!Array.isArray(evidence.send) || !evidence.send[0]) failures.push("send");
    if (failures.length)
        throw new Error(
            `Koishi 互操作证据不完整：${failures.join(", ")}\n${JSON.stringify(evidence)}`,
        );
}
