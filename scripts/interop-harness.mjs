import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const MAX_LOG_BYTES = 64 * 1024;

/**
 * 从空白工作区走完整产品链准备网关：manager -> 设备码 -> 安装代际 -> 配置 -> gateway。
 * 框架脚本不得再直接调用旧的内部网关入口。
 */
export async function startManagedGateway({
    root,
    workspace,
    gatewayPort,
    configSource,
    protocolPackage,
    protocolConfig,
    framework,
    children,
}) {
    const managerPort = gatewayPort;
    const artifacts = path.join(workspace, "runtime-artifacts");
    const managerWorkspace = fs.mkdtempSync(
        path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "ob-i-"),
    );
    const { packControlRuntime } = await import(
        pathToFileURL(path.join(root, "scripts/pack-control-runtime.mjs")).href
    );
    await packControlRuntime({
        repositoryRoot: root,
        outputDirectory: artifacts,
        extensionDirectories: ["adapters/adapter-mock"],
    });
    const manager = startProcess(
        process.execPath,
        [
            path.join(root, "packages/onebots/lib/bin.js"),
            "run",
            "--data-dir",
            managerWorkspace,
            "--host",
            "127.0.0.1",
            "--port",
            String(managerPort),
        ],
        { ONEBOTS_RUNTIME_ARTIFACTS: path.join(artifacts, "manifest.json") },
        "OneBots manager",
        root,
    );
    manager.workspace = managerWorkspace;
    children.push(manager);

    const { createLocalControlClient } = await import(
        pathToFileURL(path.join(root, "packages/onebots/lib/client/local-control.js")).href
    );
    const local = createLocalControlClient(managerWorkspace);
    await waitForManager(local, manager, 15_000);
    await verifyDevicePairing(root, local, managerPort);
    const stopped = await local.gateway("stop");
    if (stopped.status !== "succeeded") throw new Error("空白网关停止失败");

    const installationStep = async (name, action) => {
        try {
            return await action();
        } catch (error) {
            throw new Error(
                `${name}失败：${error instanceof Error ? error.message : String(error)}\n${manager.logs()}`,
            );
        }
    };
    const catalog = await installationStep("读取扩展目录", () => local.installationCatalog());
    if (catalog.activeGenerationId !== null) throw new Error("互操作工作区不是空白工作区");
    const plan = await installationStep("创建扩展安装计划", () =>
        local.planInstallation(
            {
                adapters: ["mock"],
                protocols: [protocolPackage],
                applications: [framework],
            },
            null,
        ),
    );
    const requestId = `interop-${framework}-${randomUUID()}`;
    await installationStep("提交扩展安装计划", () =>
        local.install({ id: requestId, planId: plan.id }),
    );
    const installation = await waitForInstallation(local, requestId, manager, 10 * 60_000);
    if (installation.phase !== "verified" || !installation.candidateId)
        throw new Error(`扩展安装失败：${installation.phase}\n${manager.logs()}`);
    const activation = await installationStep("激活运行代际", () =>
        local.activateGeneration(installation.candidateId),
    );
    if (activation.status !== "succeeded") throw new Error("运行代际激活失败");

    await applyGatewayConfiguration(local, configSource, protocolConfig);
    const started = await local.gateway("start");
    if (started.status !== "succeeded") throw new Error("网关启动失败");
    await waitForPort(gatewayPort, manager, 20_000);
    const [status, activeCatalog] = await Promise.all([
        local.status(),
        local.installationCatalog(),
    ]);
    if (
        status.gateway.actual !== "running" ||
        !status.gateway.instance?.id ||
        status.generation.active?.id !== installation.candidateId
    )
        throw new Error(`管理服务未确认网关运行代际：${JSON.stringify(status)}`);
    const expectedSelection = {
        adapters: ["mock"],
        protocols: [protocolPackage],
        applications: [framework],
    };
    if (activeCatalog.activeGenerationId !== installation.candidateId)
        throw new Error(`扩展目录未绑定激活代际：${JSON.stringify(activeCatalog)}`);
    for (const names of ["adapters", "protocols", "applications"])
        if (
            JSON.stringify([...activeCatalog.selection[names]].sort()) !==
            JSON.stringify([...expectedSelection[names]].sort())
        )
            throw new Error(`激活代际扩展选择异常：${JSON.stringify(activeCatalog.selection)}`);
    return Object.assign(manager, { control: local });
}

export async function stopManagedGateway(processHandle) {
    if (!processHandle?.control) return;
    if (processHandle.child.exitCode !== null)
        throw new Error(`管理服务在停止网关前退出\n${processHandle.logs()}`);
    const result = await processHandle.control.gateway("stop");
    if (result.status !== "succeeded") throw new Error("网关停止失败");
    const status = await processHandle.control.status();
    if (status.gateway.actual !== "stopped" || !status.manager?.id)
        throw new Error("网关停止后管理服务状态异常");
}

/** 独立从协议 HTTP API 回读框架发送结果，不能只相信框架返回的非空消息 ID。 */
export async function verifyFrameworkSend(processHandle, evidence, options) {
    const { gatewayPort, framework, protocol, token } = options;
    const messageId = frameworkMessageId(evidence, protocol);
    const expected = `onebots-${framework}-interop-reply`;
    const rawTarget = 10001;
    const protocolTarget = protocol === "milky.v1" ? Number(evidence.event?.userId) : rawTarget;
    if (!Number.isSafeInteger(protocolTarget) || protocolTarget < 1)
        throw new Error("框架证据缺少可核验的会话目标");
    let route;
    let body;
    if (protocol === "onebot.v11") {
        route = "/mock/interop/onebot/v11/get_friend_msg_history";
        body = { user_id: protocolTarget, count: 20 };
    } else if (protocol === "satori.v1") {
        route = "/mock/interop/satori/v1/message.list";
        body = { channel_id: String(protocolTarget), limit: 20 };
    } else {
        route = "/mock/interop/milky/v1/api/get_history_messages";
        body = {
            message_scene: "friend",
            peer_id: protocolTarget,
            limit: 20,
        };
    }
    assertRunning(processHandle);
    const response = await fetch(`http://127.0.0.1:${gatewayPort}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    const messages = protocol === "satori.v1" ? result?.data?.data : result?.data?.messages;
    const found =
        Array.isArray(messages) &&
        messages.find(message => {
            const id =
                protocol === "satori.v1"
                    ? message?.id
                    : protocol === "milky.v1"
                      ? message?.message_seq
                      : message?.message_id;
            return String(id) === String(messageId) && JSON.stringify(message).includes(expected);
        });
    if (!response.ok || !found)
        throw new Error(
            `网关未能从目标 ${protocolTarget} 的消息历史独立回读框架发送结果(${String(messageId)})：${response.status} ${JSON.stringify(result)}`,
        );
    if (protocol === "milky.v1" && found.peer_id !== protocolTarget)
        throw new Error(`Milky 回读消息目标错误：${JSON.stringify(found)}`);
}

function frameworkMessageId(evidence, protocol) {
    const id =
        protocol === "satori.v1"
            ? evidence.send?.[0]
            : protocol === "milky.v1"
              ? evidence.send?.rawData?.message_seq
              : (evidence.send?.message_id ??
                evidence.send?.messageId ??
                evidence.send?.data?.message_id ??
                evidence.messageId);
    if ((typeof id !== "string" && typeof id !== "number") || String(id).length === 0)
        throw new Error("框架发送证据缺少可回读消息 ID");
    return id;
}

async function waitForManager(client, manager, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        assertRunning(manager);
        try {
            const status = await client.status();
            if (status.manager?.id) return status;
        } catch {
            // Unix socket is created asynchronously after the manager owns the blank workspace.
        }
        await delay(50);
    }
    throw new Error(`管理服务未就绪\n${manager.logs()}`);
}

async function verifyDevicePairing(root, local, managerPort) {
    const { ControlClient, createHttpControlTransport } = await import(
        pathToFileURL(path.join(root, "packages/core/lib/control.js")).href
    );
    let token = "";
    const remote = new ControlClient(
        createHttpControlTransport(`http://127.0.0.1:${managerPort}`, () => token),
    );
    const code = (await local.bootstrap()).code;
    token = (await remote.pair(code)).token;
    const [localStatus, remoteStatus] = await Promise.all([local.status(), remote.status()]);
    if (!token || remoteStatus.manager.id !== localStatus.manager.id)
        throw new Error("设备码未配对到当前管理实例");
}

async function waitForInstallation(client, id, manager, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        assertRunning(manager);
        const operation = await client.installation(id);
        if (["verified", "failed", "interrupted"].includes(operation.phase)) return operation;
        await delay(250);
    }
    throw new Error(`扩展安装超时\n${manager.logs()}`);
}

async function applyGatewayConfiguration(client, source, protocol) {
    const require = createRequire(import.meta.url);
    const yaml = require(
        require.resolve("js-yaml", {
            paths: [path.join(process.cwd(), "packages/onebots")],
        }),
    );
    const desired = yaml.load(source);
    if (!desired || typeof desired !== "object" || Array.isArray(desired))
        throw new Error("互操作网关配置无效");
    desired["mock.interop"][protocol].use_http = true;
    // 单一固定好友让入站会话和框架回复目标可从协议历史接口精确核验。
    desired["mock.interop"].friends = [
        { user_id: "10001", nickname: "互操作好友", avatar: "https://example.invalid/avatar" },
    ];
    const snapshot = await client.configurationSnapshot();
    let draft = await configurationStep("创建配置草稿", () =>
        client.createConfigurationDraft(snapshot.base),
    );
    draft = await configurationStep("添加 Mock 账号", () =>
        client.addConfigurationAccount(draft.id, {
            expectedRevision: draft.revision,
            platform: "mock",
            accountId: "interop",
        }),
    );
    draft = await configurationStep("启用目标协议", () =>
        client.setConfigurationProtocol(draft.id, {
            expectedRevision: draft.revision,
            accountKey: "mock.interop",
            protocol,
            enabled: true,
        }),
    );
    const context = await configurationStep("读取配置 Schema", () =>
        client.configurationDraftContext(draft.id),
    );
    const secretPaths = context.draft.secretStates.map(state => state.path);
    const changes = [];
    const secrets = [];
    for (const [configPath, value] of configurationLeaves(desired)) {
        if (configPath[0] === "plugins") continue;
        // 管理认证已由设备码承担；账号标识已由 addConfigurationAccount 固化。
        if (
            (configPath.length === 1 && ["access_token", "port"].includes(configPath[0])) ||
            (configPath.length === 2 && configPath[1] === "account_id")
        )
            continue;
        if (secretPaths.some(secret => samePath(secret, configPath)))
            secrets.push({ op: "set", path: configPath, value });
        else changes.push({ op: "set", path: configPath, value });
    }
    draft = context.draft;
    for (const change of changes)
        draft = await configurationStep(`写入配置 ${change.path.join(".")}`, () =>
            client.editConfigurationDraft(draft.id, {
                expectedRevision: draft.revision,
                changes: [change],
                secrets: [],
            }),
        );
    for (const secret of secrets)
        draft = await configurationStep(`写入配置秘密 ${secret.path.join(".")}`, () =>
            client.editConfigurationDraft(draft.id, {
                expectedRevision: draft.revision,
                changes: [],
                secrets: [secret],
            }),
        );
    const validation = await configurationStep("校验互操作配置", () =>
        client.validateConfigurationDraft(draft.id, draft.revision),
    );
    if (!validation.valid || !validation.receiptId)
        throw new Error(`互操作网关配置校验失败：${JSON.stringify(validation)}`);
    const applied = await configurationStep("应用互操作配置", () =>
        client.applyConfiguration(`interop-config-${randomUUID()}`, validation.receiptId),
    );
    if (applied.status !== "succeeded") throw new Error("互操作网关配置应用失败");
}

async function configurationStep(name, action) {
    try {
        return await action();
    } catch (error) {
        throw new Error(`${name}失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

function configurationLeaves(value, prefix = []) {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length === 0
    )
        return [[prefix, value]];
    return Object.entries(value).flatMap(([key, child]) =>
        configurationLeaves(child, [...prefix, key]),
    );
}

function samePath(left, right) {
    return left.length === right.length && left.every((part, index) => part === right[index]);
}

export function startProcess(command, args, environment, label, workingDirectory) {
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

export async function waitForPort(port, processHandle, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        assertRunning(processHandle);
        if (await canConnect(port)) return;
        await delay(50);
    }
    throw new Error(`${processHandle.label} 未监听端口 ${port}\n${processHandle.logs()}`);
}

export async function waitForEvidence(evidenceFile, processHandles, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        processHandles.forEach(assertRunning);
        if (fs.existsSync(evidenceFile)) return JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
        await delay(50);
    }
    throw new Error(
        `未收到互操作证据\n${processHandles.map(item => `${item.label}:\n${item.logs()}`).join("\n")}`,
    );
}

export async function stopProcess(processHandle) {
    try {
        if (processHandle.child.exitCode === null) {
            processHandle.child.kill("SIGTERM");
            const stopped = await Promise.race([processHandle.exit.then(() => true), delay(3_000)]);
            if (stopped !== true && processHandle.child.exitCode === null) {
                processHandle.child.kill("SIGKILL");
                await processHandle.exit;
            }
        }
    } finally {
        if (processHandle.workspace)
            fs.rmSync(processHandle.workspace, { recursive: true, force: true });
    }
}

export function allocatePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("无法分配端口"));
            server.close(error => (error ? reject(error) : resolve(address.port)));
        });
    });
}

function canConnect(port) {
    return new Promise(resolve => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(250);
        const finish = value => {
            socket.destroy();
            resolve(value);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.once("timeout", () => finish(false));
    });
}

function assertRunning(processHandle) {
    if (processHandle.child.exitCode !== null) {
        throw new Error(`${processHandle.label} 提前退出\n${processHandle.logs()}`);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
