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
import {
    claimServiceProcessOwnership,
    closeServiceProcessOwnership,
} from "../service-migration-processes.js";
import { serviceMigrationStatus } from "./service-migration-api.js";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { GatewayController } from "./gateway-controller.js";
import { NodeGatewayDriver } from "./gateway-driver.js";
import { GenerationActivationController } from "./generation-activation.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import { createHostInstallation } from "./host-installation.js";
import { ConfigurationApplication } from "../configuration/configuration-application.js";
import { createGatewayConfigurationSnapshot } from "./gateway-configuration-snapshot.js";
import { ConfigurationRecoveryStore } from "../configuration/configuration-recovery-store.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { controlDirectory, prepareGatewayWorkspace, gatewayProcessExists } from "./workspace.js";
import { listen } from "./http-utils.js";
import { ControlConfigurationService } from "./configuration-service.js";
import packageMetadata from "../../package.json" with { type: "json" };
import {
    completeWindowsGatewayOperation,
    WindowsManagerStatusPublisher,
} from "../windows-manager-status-publisher.js";
import { publishWindowsManagerStartup } from "../windows-manager-startup.js";
import { createControlRequestHandler } from "./host-http.js";
import { ControlTerminalService } from "./terminal-service.js";
import { createAdmittedHostTransports } from "./host-transports.js";
import type { AdmittedControlHostInput } from "./host-options.js";
import { createAdmittedHostStorage, createAdmittedWindowsPublisher } from "./host-storage.js";
export async function startAdmittedControlHost(input: AdmittedControlHostInput) {
    const {
        options,
        workspace,
        bundledRuntimeRoot,
        windowsNativeMode,
        filesystemControlSocket,
        socketPath,
        webRoot,
        trustedProxyAddresses,
        id,
        admission,
        binding,
        installDeploymentAuth,
        release,
    } = input;
    // Windows manager 已在 native host 创建的 KILL_ON_JOB_CLOSE Job Object 内；受保护管道
    // 的 publish 确认替代 POSIX PID/进程组收据，后者在 Windows 无可靠语义。
    const ownershipAvailable = windowsNativeMode
        ? true
        : await claimServiceProcessOwnership(workspace, id, false, admission.initialProcessState);
    let lifecycle: GenerationActivationController;
    let configurationApplication: ConfigurationApplication | undefined;
    let configuration: ControlConfigurationService | undefined;
    let configurationStorageUnavailable = false;
    const storage = createAdmittedHostStorage({
        workspace,
        id,
        binding,
        ownershipAvailable,
        installDeploymentAuth,
        activeGenerationId: () => lifecycle?.status().active?.id,
        release,
    });
    const {
        controlLogs,
        notifications,
        chatHistory,
        observeOperation,
        auth,
        generations,
        respondSnapshot,
    } = storage;
    let authAvailable = storage.authAvailable;
    let storageError = storage.storageError;
    const driver = new NodeGatewayDriver({
        controlInstanceId: id,
        prepare: async () => {
            const prepared = prepareGatewayWorkspace(workspace, bundledRuntimeRoot);
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
            if (error) {
                try {
                    notifications?.gatewayExited();
                } catch {
                    process.stderr.write("[onebots] 网关退出告警持久化失败\n");
                }
            }
            void controller
                .observeExit(instanceId, error)
                .then(() => publishWindowsStatus())
                .catch(() => {
                    process.stderr.write(
                        "[onebots] 网关退出状态无法持久化或发布，请检查工作区存储\n",
                    );
                });
        },
        onDisconnect: account => {
            try {
                notifications?.observeDisconnect(account);
            } catch {
                process.stderr.write("[onebots] 账号连接中断告警持久化失败\n");
            }
        },
    });
    let publisher: WindowsManagerStatusPublisher | undefined;
    let windowsStatusHeartbeat: NodeJS.Timeout | undefined;
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
            observeOperation(operation);
            void publishWindowsStatus();
        },
        initialDesired: serviceMigrationStatus(workspace).pending ? "stopped" : "running",
    });
    if (options.windowsHostPipe)
        publisher = createAdmittedWindowsPublisher(
            options.windowsHostPipe,
            { id, version: packageMetadata.version, pid: process.pid },
            workspace,
        );
    const readVerified = (id: string) => {
        if (!generations) throw new Error("运行版本仓库不可用");
        return generations.readVerified(id);
    };
    const activationVerification = new GenerationConfigurationVerifier(
        workspace,
        readVerified,
        undefined,
        bundledRuntimeRoot,
    );
    lifecycle = new GenerationActivationController({
        statePath: path.join(controlDirectory(workspace), "active-generation.json"),
        gateway: controller,
        readVerified,
        verifyActivation: (generation, revision) =>
            activationVerification.verify(generation, revision),
        hasLiveChildren: () => driver.hasLiveChildren(),
        runtimeConfiguration: {
            context: () => {
                const instance = controller.status().instance;
                return instance ? driver.runtimeContext(instance.id) : undefined;
            },
            apply: input => driver.applyRuntimeConfiguration(input),
            query: input => driver.queryRuntimeConfiguration(input),
        },
        configurationRecoveryRequired: () =>
            configurationStorageUnavailable ||
            Boolean(configurationApplication?.health().recoveryRequired),
        onOperation: observeOperation,
    });
    const upgradeIdentity = createManagerUpgradeIdentity(
        id,
        new URL("./host.js", import.meta.url).href,
    );
    const releaseUpgrade = createManagerUpgradeRelease(
        workspace,
        id,
        new URL("./host.js", import.meta.url).href,
        lifecycle,
        () => !closed && !storageError && ownershipAvailable,
    );
    try {
        configurationApplication = new ConfigurationApplication({
            directory: path.join(controlDirectory(workspace), "configuration-applications"),
            source: new ConfigurationFile(path.join(workspace, "config.yaml")),
            runtime: {
                snapshot: document => createGatewayConfigurationSnapshot(workspace, document),
            },
            planImpact: (before, after) =>
                activationVerification.planImpact(lifecycle.activeGeneration(), before, after),
            recovery: new ConfigurationRecoveryStore(
                path.join(controlDirectory(workspace), "configuration/recovery"),
            ),
            lifecycle,
            onOperation: observeOperation,
        });
        if (generations && ownershipAvailable)
            configuration = new ControlConfigurationService({
                directory: path.join(controlDirectory(workspace), "configuration"),
                configFile: path.join(workspace, "config.yaml"),
                runtimeRoot: bundledRuntimeRoot,
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
        observeOperation,
    );
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
            onOperation: observeOperation,
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
        onOperation: observeOperation,
        available: () =>
            !closed &&
            !storageError &&
            ownershipAvailable &&
            !configurationStorageUnavailable &&
            !configurationApplication?.health().recoveryRequired,
    });
    notifications?.setChallengeResolver(async challengeId => {
        const snapshot = await verification.service.snapshot();
        return snapshot.challenges.find(challenge => challenge.id === challengeId);
    });
    const messageDebug = new ControlMessageDebugService({
        currentInstance: currentGateway,
        forward: (instanceId, action) => driver.messageDebug(instanceId, action),
    });
    const messageDebugHttp = new ControlMessageDebugHttp(messageDebug, auth);
    let notificationPolling = false;
    const notificationTimer = setInterval(() => {
        if (!notifications || notificationPolling || closed) return;
        notificationPolling = true;
        void (async () => {
            try {
                const instanceId = currentGateway();
                const status = instanceId
                    ? driver.accountStatuses(instanceId)
                    : { available: false, items: [] };
                // 运行中的网关暂时没有状态快照时不能推断全部账号离线；无实例才是已停止。
                if (!instanceId || status.available)
                    notifications?.observeAccounts(status.available ? status.items : []);
                if (instanceId) {
                    const snapshot = await verification.service.snapshot();
                    notifications?.observeChallenges(snapshot.challenges);
                }
            } catch {
                // 网关切换时快照短暂不可用；下次轮询继续，不能影响管理服务。
            } finally {
                notificationPolling = false;
            }
        })();
    }, 2_000);
    notificationTimer.unref();
    const terminal = new ControlTerminalService({
        workspace,
        manager: { id, version: packageMetadata.version },
        available: () =>
            !closed &&
            authAvailable &&
            ownershipAvailable &&
            !storageError &&
            !serviceMigrationStatus(workspace).pending,
    });
    let server: http.Server;
    const handle = createControlRequestHandler({
        trustedProxyAddresses,
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
        chatHistory,
        accountExplore: {
            context: () => {
                const instanceId = currentGateway();
                return instanceId ? driver.sendContext(instanceId) : undefined;
            },
            explore: request => driver.exploreAccount(request.expected.gatewayInstanceId, request),
        },
        verification,
        messageDebugHttp,
        mcp,
        releaseUpgrade,
        upgradeIdentity,
        publisher,
        terminal,
        notifications,
        activeAddress,
        respondSnapshot,
        serverAddress: () => server.address(),
    });
    const transports = createAdmittedHostTransports({
        handle,
        windowsNativeMode,
        windowsHostRpcPipe: options.windowsHostRpcPipe,
        terminal,
        activeAddress,
    });
    server = transports.server;
    const local = transports.local;
    await transports.attach();
    async function close() {
        if (closed) return;
        closed = true;
        transports.stopReconnect();
        if (windowsStatusHeartbeat) clearInterval(windowsStatusHeartbeat);
        clearInterval(notificationTimer);
        const notificationsClosed = notifications?.close();
        messageDebugHttp.close();
        chatHistory?.close();
        terminal.close();
        const verificationClosed = verification.close();
        messageDebug.close();
        await activationVerification.close();
        await configuration?.close();
        await installation?.service?.close();
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
        await notificationsClosed;
        await verificationClosed;
        await transports.closeListeners();
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
            await publishWindowsManagerStartup(() => publisher.publish(controller.status()));
            windowsStatusHeartbeat = setInterval(() => {
                void publishWindowsStatus();
            }, 10_000);
            windowsStatusHeartbeat.unref();
        }
        controlLogs.manager("ready");
        return {
            id,
            admission: admission.inspection,
            controller: { status: () => controller.status() },
            server,
            socketPath,
            close,
        };
    } catch (error) {
        await close();
        throw error;
    }
}
