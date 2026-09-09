import { respondControlLogs } from "./logs-http.js";
import { createControlLogWriter } from "./gateway-log.js";
import {
    createManagerUpgradeRelease,
    createManagerUpgradeIdentity,
} from "./service-upgrade-release.js";
import { managerUpgradeStatus } from "../service-upgrade-workspace.js";
import { GenerationConfigurationVerifier } from "./generation-configuration.js";
import { authorizeControlHttp } from "./auth-check.js";
import { ControlSendService } from "./send-service.js";
import { respondControlSend } from "./send-http.js";
import { createHostVerification } from "./host-verification.js";
import { ControlMessageDebugService } from "./message-debug-service.js";
import { ControlMessageDebugHttp } from "./message-debug-http.js";
import { ControlMcpService } from "./mcp-api.js";
import { respondControlMcp } from "./mcp-http.js";
import { serveControlWeb } from "./web-assets.js";
import { createControlSnapshotResponder, gatewayDiagnosticStatus } from "./diagnostics.js";
import {
    claimServiceProcessOwnership,
    closeServiceProcessOwnership,
} from "../service-migration-processes.js";
import { handleControlAuthRequest } from "./auth-api.js";
import { handleServiceMigrationRequest, serviceMigrationStatus } from "./service-migration-api.js";
import fs from "node:fs";
import path from "node:path";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ControlAuth } from "./auth.js";
import { consumeDeploymentAuthenticationEnvironment } from "./auth-deployment.js";
import { GatewayController } from "./gateway-controller.js";
import { NodeGatewayDriver } from "./gateway-driver.js";
import { GenerationActivationController } from "./generation-activation.js";
import { GenerationStore } from "../installation/generation-store.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import { createHostInstallation } from "./host-installation.js";
import { handleInstallationRequest, isInstallationPath } from "./installation-api.js";
import { ConfigurationApplication } from "../configuration/configuration-application.js";
import { ConfigurationRecoveryStore } from "../configuration/configuration-recovery-store.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import {
    acquireControlWorkspace,
    controlDirectory,
    controlSocket,
    prepareGatewayWorkspace,
    gatewayProcessExists,
} from "./workspace.js";
import { proxyGatewayHttp, proxyGatewayUpgrade } from "./proxy.js";
import { listen, readBody, jsonResponse as json } from "./http-utils.js";
import { ControlConfigurationService } from "./configuration-service.js";
import { handleConfigurationRequest, isConfigurationPath } from "./configuration-api.js";
import type { ControlHostOptions } from "./host-options.js";
import packageMetadata from "../../package.json" with { type: "json" };
import {
    completeWindowsGatewayOperation,
    WindowsManagerStatusPublisher,
} from "../windows-manager-status-publisher.js";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";
import { connectWindowsManagerRPC } from "../windows-manager-rpc.js";
export type { ControlHostOptions } from "./host-options.js";
export async function startControlHost(options: ControlHostOptions) {
    if (
        options.windowsHostPipe &&
        (process.platform !== "win32" || options.windowsHostPipe !== WINDOWS_HOST_PIPE_NAME)
    )
        throw new Error("Windows 原生宿主管道无效");
    if (
        (options.windowsHostRpcPipe !== undefined) !== (options.windowsHostPipe !== undefined) ||
        (options.windowsHostRpcPipe !== undefined &&
            !/^\\\\\.\\pipe\\onebots-manager-rpc-[0-9a-f]{32}$/.test(options.windowsHostRpcPipe))
    )
        throw new Error("Windows 原生宿主 RPC 管道无效");
    const installDeploymentAuth = consumeDeploymentAuthenticationEnvironment();
    fs.mkdirSync(options.workspace, { recursive: true });
    const workspace = fs.realpathSync(options.workspace);
    const windowsNativeMode = options.windowsHostPipe !== undefined;
    // Windows foreground/candidate verification has no Unix socket. Production Windows service
    // supplies windowsHostPipe and is additionally bound to the native Job Object/status channel.
    const socketPath =
        options.windowsHostPipe ?? (process.platform === "win32" ? "" : controlSocket(workspace));
    const webRoot =
        options.webRoot ??
        path.join(
            path.dirname(createRequire(import.meta.url).resolve("@onebots/web/package.json")),
            "dist",
        );
    const freshWorkspace = !fs.existsSync(controlDirectory(workspace));
    const release = acquireControlWorkspace(workspace);
    const id = randomUUID();
    // Windows manager 已在 native host 创建的 KILL_ON_JOB_CLOSE Job Object 内；受保护管道
    // 的 publish 确认替代 POSIX PID/进程组收据，后者在 Windows 无可靠语义。
    const ownershipAvailable = windowsNativeMode
        ? true
        : await claimServiceProcessOwnership(workspace, id, freshWorkspace);
    const controlLogs = createControlLogWriter(workspace, id);
    let auth: ControlAuth | undefined;
    let authAvailable = true;
    let storageError = !ownershipAvailable || serviceMigrationStatus(workspace).recoveryRequired;
    let lifecycle: GenerationActivationController;
    let generations: GenerationStore | undefined;
    let configurationApplication: ConfigurationApplication | undefined;
    let configuration: ControlConfigurationService | undefined;
    let configurationStorageUnavailable = false;
    try {
        generations = new GenerationStore({
            root: path.join(controlDirectory(workspace), "generations"),
            isActive: generationId => lifecycle?.status().active?.id === generationId,
        });
    } catch {
        storageError = true;
        process.stderr.write("[onebots] 运行版本仓库不可读取，保持管理端用于诊断\n");
    }
    try {
        auth = new ControlAuth({ statePath: path.join(controlDirectory(workspace), "auth.json") });
        installDeploymentAuth?.(auth);
    } catch {
        authAvailable = false;
        process.stderr.write("[onebots] 控制认证存储不可用，远程管理已禁用\n");
    }
    const respondSnapshot = createControlSnapshotResponder(workspace, generations);
    const driver = new NodeGatewayDriver({
        controlInstanceId: id,
        prepare: async () => {
            const prepared = prepareGatewayWorkspace(workspace, options.runtimeRoot);
            const generation = lifecycle.activeGeneration();
            return {
                ...prepared,
                ...(generation
                    ? resolveGenerationRuntime(generation, prepared.selection)
                    : options.gatewayEntrypoint
                      ? { entrypoint: options.gatewayEntrypoint }
                      : {}),
            };
        },
        onExit: (instanceId, error) => {
            void controller
                .observeExit(instanceId, error)
                .then(() => publishWindowsStatus())
                .catch(() => {
                    process.stderr.write(
                        "[onebots] 网关退出状态无法持久化或发布，请检查工作区存储\n",
                    );
                });
        },
    });
    let publisher: WindowsManagerStatusPublisher | undefined;
    let windowsStatusHeartbeat: NodeJS.Timeout | undefined;
    let windowsRpcReconnect: NodeJS.Timeout | undefined;
    let windowsRpcClosed = false;
    function publishWindowsStatus(): Promise<void> {
        if (!publisher) return Promise.resolve();
        return publisher.publish(controller.status()).catch(() => {
            process.stderr.write("[onebots] Windows 原生宿主状态发布失败\n");
        });
    }
    const controller = new GatewayController({
        statePath: path.join(controlDirectory(workspace), "gateway.json"),
        driver,
        onOperation: operation => {
            controlLogs.operation(operation);
            void publishWindowsStatus();
        },
        initialDesired: serviceMigrationStatus(workspace).pending ? "stopped" : "running",
    });
    if (options.windowsHostPipe)
        publisher = new WindowsManagerStatusPublisher(options.windowsHostPipe, {
            id,
            version: packageMetadata.version,
            pid: process.pid,
        });
    const readVerified = (id: string) => {
        if (!generations) throw new Error("运行版本仓库不可用");
        return generations.readVerified(id);
    };
    const activationVerification = new GenerationConfigurationVerifier(workspace, readVerified);
    lifecycle = new GenerationActivationController({
        statePath: path.join(controlDirectory(workspace), "active-generation.json"),
        gateway: controller,
        readVerified,
        verifyActivation: (generation, revision) =>
            activationVerification.verify(generation, revision),
        hasLiveChildren: () => driver.hasLiveChildren(),
        configurationRecoveryRequired: () =>
            configurationStorageUnavailable ||
            Boolean(configurationApplication?.health().recoveryRequired),
        onOperation: controlLogs.operation,
    });
    const upgradeIdentity = createManagerUpgradeIdentity(id, import.meta.url);
    const releaseUpgrade = createManagerUpgradeRelease(
        workspace,
        id,
        import.meta.url,
        lifecycle,
        () => !closed && !storageError && ownershipAvailable,
    );
    try {
        configurationApplication = new ConfigurationApplication({
            directory: path.join(controlDirectory(workspace), "configuration-applications"),
            source: new ConfigurationFile(path.join(workspace, "config.yaml")),
            recovery: new ConfigurationRecoveryStore(
                path.join(controlDirectory(workspace), "configuration/recovery"),
            ),
            lifecycle,
            onOperation: controlLogs.operation,
        });
        if (generations && ownershipAvailable)
            configuration = new ControlConfigurationService({
                directory: path.join(controlDirectory(workspace), "configuration"),
                configFile: path.join(workspace, "config.yaml"),
                runtimeRoot: options.runtimeRoot ?? process.cwd(),
                generations,
                application: configurationApplication,
                activeGeneration: () => lifecycle.activeGeneration(),
            });
    } catch {
        configurationStorageUnavailable = true;
        process.stderr.write("[onebots] 配置应用记录不可用，保留管理端用于诊断\n");
    }
    const installation = await createHostInstallation(
        options,
        workspace,
        generations,
        lifecycle,
        ownershipAvailable,
        controlLogs.operation,
    );
    const sockets = new Set<Duplex>();
    let closed = false;
    function activeAddress() {
        const state = controller.status();
        return state.actual === "running" &&
            !state.recoveryRequired &&
            !lifecycle.status().recoveryRequired &&
            !configurationStorageUnavailable &&
            !configurationApplication?.health().recoveryRequired &&
            driver.hasLiveChildren()
            ? state.instance?.address
            : undefined;
    }
    const currentGateway = () =>
        !closed && !storageError && activeAddress() && !serviceMigrationStatus(workspace).pending
            ? controller.status().instance?.id
            : undefined;
    const mcp = new ControlMcpService({
        currentGateway,
        forward: (instanceId, request) => driver.mcp(instanceId, request),
    });
    let sending: ControlSendService | undefined;
    try {
        sending = new ControlSendService({
            directory: path.join(controlDirectory(workspace), "messages"),
            currentContext: () => {
                const instanceId = currentGateway();
                return instanceId ? driver.sendContext(instanceId) : undefined;
            },
            forward: request => driver.send(request.expected.gatewayInstanceId, request),
            onOperation: controlLogs.operation,
        });
    } catch {
        process.stderr.write("[onebots] 发送操作记录不可用，管理端保留用于诊断\n");
    }
    const verification = createHostVerification({
        workspace,
        auth,
        driver,
        lifecycle,
        currentGateway,
        onOperation: controlLogs.operation,
        available: () =>
            !closed &&
            !storageError &&
            ownershipAvailable &&
            !configurationStorageUnavailable &&
            !configurationApplication?.health().recoveryRequired,
    });
    const messageDebug = new ControlMessageDebugService({
        currentInstance: currentGateway,
        forward: (instanceId, action) => driver.messageDebug(instanceId, action),
    });
    const messageDebugHttp = new ControlMessageDebugHttp(messageDebug, auth);
    async function handle(request: IncomingMessage, response: ServerResponse, local: boolean) {
        try {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (request.method === "GET" && ["/ready", "/healthz"].includes(pathname)) {
                json(response, 200, {
                    application: "onebots",
                    version: packageMetadata.version,
                    instance_id: id,
                    ready: true,
                });
                return;
            }
            if (pathname.startsWith("/api/")) {
                if (closed && request.method === "POST") {
                    json(response, 503, { message: "管理服务正在关闭" });
                    return;
                }
                if (request.method !== "GET" && request.method !== "POST") {
                    json(response, 405, { message: "不支持此方法" });
                    return;
                }
                if (
                    !local &&
                    request.headers.origin &&
                    new URL(request.headers.origin).host !== request.headers.host
                ) {
                    json(response, 403, { message: "控制请求来源无效" });
                    return;
                }
                const authentication = await handleControlAuthRequest(request, local, auth, mcp);
                if (authentication) {
                    json(response, authentication.status, authentication.body);
                    return;
                }
                if (!local) {
                    const checked = authorizeControlHttp(auth, request, response, authAvailable);
                    if (checked.storageUnavailable) authAvailable = false;
                    if (!checked.authorized) return;
                }
                const migration = await handleServiceMigrationRequest({
                    workspace,
                    ownershipAvailable,
                    pathname,
                    method: request.method,
                    local,
                    body: () => readBody(request),
                    releaseUpgrade,
                    upgradeIdentity,
                });
                if (migration) {
                    json(response, migration.status, migration.body);
                    return;
                }
                if (
                    ["/api/control/status", "/api/control/diagnostics"].includes(pathname) &&
                    request.method === "GET"
                ) {
                    const status = {
                        schemaVersion: 1,
                        manager: { id, version: packageMetadata.version, pid: process.pid },
                        gateway: gatewayDiagnosticStatus(controller.status(), storageError),
                        authAvailable,
                        processOwnership: { available: ownershipAvailable },
                        serviceMigration: serviceMigrationStatus(workspace),
                        generation: lifecycle.status(),
                        installationAvailable: Boolean(installation),
                        configuration: {
                            recoveryRequired:
                                configurationStorageUnavailable ||
                                Boolean(configurationApplication?.health().recoveryRequired),
                        },
                    };
                    respondSnapshot(response, pathname, status, server.address());
                    return;
                }
                if (await respondControlSend(sending, request, response, pathname, local, auth))
                    return;
                if (respondControlLogs(workspace, request, response, pathname, local, auth)) return;
                if (await verification.handle(request, response, pathname, local)) return;
                if (await messageDebugHttp.handle(request, response, pathname, local)) return;
                if (await respondControlMcp(mcp, request, response, pathname, local, auth)) return;
                if (isInstallationPath(pathname)) {
                    const address = request.socket.remoteAddress;
                    const result = await handleInstallationRequest({
                        pathname,
                        method: request.method,
                        body: () => readBody(request),
                        service: installation,
                        allowCredentials:
                            local ||
                            address === "127.0.0.1" ||
                            address === "::1" ||
                            address === "::ffff:127.0.0.1",
                    });
                    json(response, result.status, result.body);
                    return;
                }
                if (isConfigurationPath(pathname)) {
                    const address = request.socket.remoteAddress;
                    const result = await handleConfigurationRequest({
                        pathname,
                        method: request.method,
                        body: () => readBody(request, 1_048_576),
                        service: configuration,
                        local,
                        allowCredentials:
                            local ||
                            address === "127.0.0.1" ||
                            address === "::1" ||
                            address === "::ffff:127.0.0.1",
                    });
                    json(response, result.status, result.body);
                    return;
                }
                const action = /^\/api\/control\/gateway\/(start|stop|restart)$/.exec(
                    pathname,
                )?.[1];
                if (action && request.method === "POST") {
                    await readBody(request);
                    if (storageError) {
                        json(response, 503, { message: "控制状态不可读取，禁止修改" });
                        return;
                    }
                    const operation = await completeWindowsGatewayOperation(
                        async () => {
                            if (controller.status().recoveryRequired && !driver.hasLiveChildren()) {
                                const prior = controller.status().instance;
                                if (prior?.pid && gatewayProcessExists(prior.pid))
                                    throw new Error("旧实例仍存在，拒绝重复启动");
                                if (!prior)
                                    throw new Error("前次启动结果未知，不能认定旧进程已退出");
                                if (!prior.pid)
                                    throw new Error("旧实例身份无法核实，需检查本地运行状态");
                                await lifecycle.reconcileStopped(state => {
                                    if (driver.hasLiveChildren()) return false;
                                    return state.instance?.pid
                                        ? !gatewayProcessExists(state.instance.pid)
                                        : false;
                                });
                            }
                            return action === "start"
                                ? lifecycle.start()
                                : action === "stop"
                                  ? lifecycle.stop()
                                  : lifecycle.restart();
                        },
                        () => controller.status(),
                        publisher,
                    );
                    json(response, 200, operation);
                    return;
                }
                json(response, 404, { message: "控制接口不存在" });
                return;
            }
            if (local) {
                json(response, 404, { message: "本地控制接口不存在" });
                return;
            }
            if (serveControlWeb(request, response, pathname, webRoot)) return;
            proxyGatewayHttp(request, response, activeAddress());
        } catch {
            if (!response.headersSent)
                json(response, 500, { message: "控制操作失败，请检查本地状态与日志" });
            else response.destroy();
        }
    }
    const server = http.createServer((req, res) => {
        void handle(req, res, false);
    });
    const local = http.createServer((req, res) => {
        void handle(req, res, true);
    });
    for (const listener of windowsNativeMode ? [server] : [server, local]) {
        listener.on("connection", socket => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
        listener.requestTimeout = 30_000;
        listener.headersTimeout = 10_000;
    }
    // native host owns this private transport for the manager lifetime. Disabling Node's
    // five-second idle reap avoids losing the sole authenticated reverse channel.
    local.keepAliveTimeout = 0;
    server.on("upgrade", (req, socket, head) => {
        try {
            if (new URL(req.url ?? "/", "http://localhost").pathname.startsWith("/api/")) {
                socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                return;
            }
            proxyGatewayUpgrade(req, socket, head, activeAddress());
        } catch {
            socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        }
    });
    if (options.windowsHostRpcPipe) {
        const attach = async (): Promise<void> => {
            try {
                const socket = await connectWindowsManagerRPC(options.windowsHostRpcPipe!);
                if (windowsRpcClosed) {
                    socket.destroy();
                    return;
                }
                local.emit("connection", socket);
                socket.once("close", () => {
                    if (!windowsRpcClosed) {
                        windowsRpcReconnect = setTimeout(() => void attach(), 25);
                        windowsRpcReconnect.unref();
                    }
                });
            } catch {
                if (!windowsRpcClosed) {
                    windowsRpcReconnect = setTimeout(() => void attach(), 25);
                    windowsRpcReconnect.unref();
                }
            }
        };
        await attach();
    }
    async function close() {
        if (closed) return;
        closed = true;
        windowsRpcClosed = true;
        if (windowsRpcReconnect) clearTimeout(windowsRpcReconnect);
        if (windowsStatusHeartbeat) clearInterval(windowsStatusHeartbeat);
        messageDebugHttp.close();
        const verificationClosed = verification.close();
        messageDebug.close();
        await activationVerification.close();
        await configuration?.close();
        await installation?.close();
        try {
            if (!storageError || driver.hasLiveChildren())
                await completeWindowsGatewayOperation(
                    () => lifecycle.shutdown(),
                    () => controller.status(),
                    publisher,
                );
        } catch {
            if (driver.hasLiveChildren()) {
                closed = false;
                throw new Error("网关尚未确认退出，保留管理锁");
            }
        }
        if (driver.hasLiveChildren()) {
            closed = false;
            throw new Error("网关尚未确认退出，保留管理锁");
        }
        await publisher?.flush();
        await sending?.close();
        await verificationClosed;
        for (const socket of sockets) socket.destroy();
        await Promise.all(
            [server, local].map(
                listener => new Promise<void>(resolve => listener.close(() => resolve())),
            ),
        );
        try {
            if (!windowsNativeMode && fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
            if (ownershipAvailable && !windowsNativeMode)
                await closeServiceProcessOwnership(workspace, id);
        } finally {
            controlLogs.manager("stopped");
            release();
        }
    }
    try {
        let state = controller.status();
        try {
            await lifecycle.initialize();
            state = controller.status();
        } catch {
            storageError = true;
            process.stderr.write("[onebots] 控制状态不可读取，保持管理端用于诊断\n");
        }
        if (!windowsNativeMode) {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
            await listen(local, socketPath);
            fs.chmodSync(socketPath, 0o600);
        }
        await listen(server, options.port ?? 6727, options.host ?? "127.0.0.1");
        try {
            if (
                !storageError &&
                !lifecycle.status().recoveryRequired &&
                state.recoveryRequired &&
                state.instance?.pid
            ) {
                const previousPid = state.instance.pid;
                for (let attempt = 0; attempt < 30 && gatewayProcessExists(previousPid); attempt++)
                    await new Promise(resolve => setTimeout(resolve, 100));
                if (!gatewayProcessExists(previousPid)) {
                    await lifecycle.reconcileStopped(
                        current =>
                            current.instance?.pid === previousPid &&
                            !driver.hasLiveChildren() &&
                            !gatewayProcessExists(previousPid),
                    );
                    state = controller.status();
                }
            }
            if (
                !storageError &&
                !lifecycle.status().recoveryRequired &&
                !state.recoveryRequired &&
                !configurationStorageUnavailable &&
                !configurationApplication?.health().recoveryRequired &&
                !managerUpgradeStatus(workspace).pending &&
                state.desired === "running"
            ) {
                await lifecycle.start();
            }
        } catch {
            storageError = true;
            process.stderr.write("[onebots] 网关启动或恢复状态无法持久化，管理端保留用于诊断\n");
        }
        if (publisher) {
            let published = false;
            for (let attempt = 0; attempt < 50 && !published; attempt++) {
                try {
                    await publisher.publish(controller.status());
                    published = true;
                } catch {
                    if (attempt === 49) throw new Error("Windows 原生宿主状态发布失败");
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            windowsStatusHeartbeat = setInterval(() => {
                void publishWindowsStatus();
            }, 10_000);
            windowsStatusHeartbeat.unref();
        }
        controlLogs.manager("ready");
        return { id, controller: { status: () => controller.status() }, server, socketPath, close };
    } catch (error) {
        await close();
        throw error;
    }
}
