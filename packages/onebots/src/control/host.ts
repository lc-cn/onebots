import { appendControlLog, createControlLogWriter } from "./gateway-log.js";
import {
    createManagerUpgradeRelease,
    createManagerUpgradeIdentity,
} from "./service-upgrade-release.js";
import { managerUpgradeStatus } from "../service-upgrade-workspace.js";
import { GenerationConfigurationVerifier } from "./generation-configuration.js";
import { ControlSendService } from "./send-service.js";
import { createHostVerification } from "./host-verification.js";
import { ControlMessageDebugService } from "./message-debug-service.js";
import { ControlMessageDebugHttp } from "./message-debug-http.js";
import { ControlMcpService } from "./mcp-api.js";
import { createControlSnapshotResponder } from "./diagnostics.js";
import {
    claimServiceProcessOwnership,
    closeServiceProcessOwnership,
} from "../service-migration-processes.js";
import { serviceMigrationStatus } from "./service-migration-api.js";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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
import { ConfigurationApplication } from "../configuration/configuration-application.js";
import { ConfigurationRecoveryStore } from "../configuration/configuration-recovery-store.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import {
    acquireControlWorkspace,
    controlDirectory,
    controlSocket,
    prepareGatewayWorkspace,
    gatewayProcessExists,
    supportsFilesystemControlSocket,
} from "./workspace.js";
import { proxyGatewayUpgrade } from "./proxy.js";
import { listen } from "./http-utils.js";
import { ControlConfigurationService } from "./configuration-service.js";
import type { ControlHostOptions } from "./host-options.js";
import packageMetadata from "../../package.json" with { type: "json" };
import {
    completeWindowsGatewayOperation,
    WindowsManagerStatusPublisher,
} from "../windows-manager-status-publisher.js";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";
import { connectWindowsManagerRPC } from "../windows-manager-rpc.js";
import { createControlRequestHandler } from "./host-http.js";
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
    const filesystemControlSocket = supportsFilesystemControlSocket();
    // Windows foreground/candidate verification has no Unix socket. Production Windows service
    // supplies windowsHostPipe and is additionally bound to the native Job Object/status channel.
    const socketPath =
        options.windowsHostPipe ?? (filesystemControlSocket ? controlSocket(workspace) : "");
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
        publisher = new WindowsManagerStatusPublisher(
            options.windowsHostPipe,
            {
                id,
                version: packageMetadata.version,
                pid: process.pid,
            },
            undefined,
            failure => {
                try {
                    appendControlLog(
                        workspace,
                        "operation",
                        `${JSON.stringify({
                            time: new Date().toISOString(),
                            action: `windows-status.${failure.phase}`,
                            status: "failed",
                            code: failure.code,
                        })}\n`,
                    );
                } catch {
                    process.stderr.write("[onebots] Windows 状态失败诊断不可写\n");
                }
            },
        );
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
    let server: http.Server;
    const handle = createControlRequestHandler({
        workspace,
        webRoot,
        manager: { id, version: packageMetadata.version, pid: process.pid },
        auth,
        authAvailable: () => authAvailable,
        markAuthUnavailable: () => {
            authAvailable = false;
        },
        closed: () => closed,
        storageError: () => storageError,
        ownershipAvailable,
        configurationStorageUnavailable: () => configurationStorageUnavailable,
        configurationApplication,
        controller,
        driver,
        lifecycle,
        installation,
        configuration,
        sending,
        verification,
        messageDebugHttp,
        mcp,
        releaseUpgrade,
        upgradeIdentity,
        publisher,
        activeAddress,
        respondSnapshot,
        serverAddress: () => server.address(),
    });
    server = http.createServer((req, res) => {
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
        if (!windowsNativeMode && filesystemControlSocket) {
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
