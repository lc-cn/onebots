import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.ONEBOTS_INTEROP_PYTHON || "python3";
const TOKEN = "onebots-nonebot-interop-token";
const EXPECTED_NONEBOT_VERSION = "2.5.0";
const EXPECTED_ADAPTER_VERSION = "2.4.6";
const MAX_LOG_BYTES = 64 * 1024;

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-nonebot-interop-"));
const evidencePath = path.join(temporaryDirectory, "evidence.json");
const configPath = path.join(temporaryDirectory, "config.yaml");
const children = [];

try {
    await assertPythonDependencies();
    prepareWorkspacePlugins();
    const [nonebotPort, gatewayPort] = await Promise.all([allocatePort(), allocatePort()]);
    fs.writeFileSync(configPath, renderGatewayConfig(gatewayPort, nonebotPort), "utf8");

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

    const evidence = await waitForEvidence(evidencePath, [nonebot, gateway], 20_000);
    assertEvidence(evidence);
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
    await Promise.all(children.reverse().map(stopProcess));
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

function startProcess(command, args, environment, label, workingDirectory = ROOT) {
    const child = spawn(command, args, {
        cwd: workingDirectory,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = chunk => {
        output = `${output}${chunk.toString()}`.slice(-MAX_LOG_BYTES);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const exit = new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
    child.once("error", error => append(`${label} spawn error: ${error.message}\n`));
    return { child, exit, label, logs: () => output };
}

function prepareWorkspacePlugins() {
    const scopeDirectory = path.join(temporaryDirectory, "node_modules", "@onebots");
    fs.mkdirSync(scopeDirectory, { recursive: true });
    for (const [name, source] of [
        ["adapter-mock", path.join(ROOT, "adapters/adapter-mock")],
        ["protocol-onebot-v11", path.join(ROOT, "protocols/onebot-v11/protocol")],
    ]) {
        fs.symlinkSync(source, path.join(scopeDirectory, name), "dir");
    }
}

async function waitForPort(port, processHandle, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (processHandle.child.exitCode !== null) {
            throw new Error(`${processHandle.label} 提前退出\n${processHandle.logs()}`);
        }
        if (await canConnect(port)) return;
        await delay(50);
    }
    throw new Error(
        `${processHandle.label} 未在 ${timeoutMs}ms 内监听端口\n${processHandle.logs()}`,
    );
}

function canConnect(port) {
    return new Promise(resolve => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(250);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        const fail = () => {
            socket.destroy();
            resolve(false);
        };
        socket.once("error", fail);
        socket.once("timeout", fail);
    });
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

async function waitForEvidence(evidenceFile, processHandles, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const processHandle of processHandles) {
            if (processHandle.child.exitCode !== null) {
                throw new Error(`${processHandle.label} 提前退出\n${processHandle.logs()}`);
            }
        }
        if (fs.existsSync(evidenceFile)) {
            return JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
        }
        await delay(50);
    }
    throw new Error(
        `未在 ${timeoutMs}ms 内收到 NoneBot 互操作证据\n${processHandles
            .map(item => `${item.label}:\n${item.logs()}`)
            .join("\n")}`,
    );
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

async function stopProcess(processHandle) {
    if (processHandle.child.exitCode !== null) return;
    processHandle.child.kill("SIGTERM");
    const stopped = await Promise.race([processHandle.exit.then(() => true), delay(3_000)]);
    if (stopped !== true && processHandle.child.exitCode === null) {
        processHandle.child.kill("SIGKILL");
        await processHandle.exit;
    }
}

function allocatePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("无法分配互操作测试端口"));
                return;
            }
            server.close(error => (error ? reject(error) : resolve(address.port)));
        });
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
