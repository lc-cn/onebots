import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlAuth } from "./auth.js";
import { handleControlAuthRequest } from "./auth-api.js";
import { authorizeControlHttp } from "./auth-check.js";
import type { ControlConfigurationService } from "./configuration-service.js";
import { handleConfigurationRequest, isConfigurationPath } from "./configuration-api.js";
import type { ConfigurationApplication } from "../configuration/configuration-application.js";
import { gatewayDiagnosticStatus } from "./diagnostics.js";
import type { GatewayController } from "./gateway-controller.js";
import type { NodeGatewayDriver } from "./gateway-driver.js";
import type { GenerationActivationController } from "./generation-activation.js";
import type { createHostInstallation } from "./host-installation.js";
import type { createHostVerification } from "./host-verification.js";
import { handleInstallationRequest, isInstallationPath } from "./installation-api.js";
import type { ControlMcpService } from "./mcp-api.js";
import { respondControlMcp } from "./mcp-http.js";
import type { ControlMessageDebugHttp } from "./message-debug-http.js";
import type {
    createManagerUpgradeIdentity,
    createManagerUpgradeRelease,
} from "./service-upgrade-release.js";
import { handleServiceMigrationRequest, serviceMigrationStatus } from "./service-migration-api.js";
import type { ControlSendService } from "./send-service.js";
import { respondControlSend } from "./send-http.js";
import { respondControlLogs } from "./logs-http.js";
import {
    completeWindowsGatewayOperation,
    type WindowsManagerStatusPublisher,
} from "../windows-manager-status-publisher.js";
import { gatewayProcessExists } from "./workspace.js";
import { readBody, jsonResponse as json } from "./http-utils.js";
import { serveControlWeb } from "./web-assets.js";
import { proxyGatewayHttp, type GatewayProxyAddress } from "./proxy.js";

interface ControlRequestHandlerOptions {
    workspace: string;
    webRoot: string;
    manager: { id: string; version: string; pid: number };
    auth: ControlAuth | undefined;
    authAvailable: () => boolean;
    markAuthUnavailable: () => void;
    closed: () => boolean;
    storageError: () => boolean;
    ownershipAvailable: boolean;
    configurationStorageUnavailable: () => boolean;
    configurationApplication: ConfigurationApplication | undefined;
    controller: GatewayController;
    driver: NodeGatewayDriver;
    lifecycle: GenerationActivationController;
    installation: Awaited<ReturnType<typeof createHostInstallation>>;
    configuration: ControlConfigurationService | undefined;
    sending: ControlSendService | undefined;
    verification: ReturnType<typeof createHostVerification>;
    messageDebugHttp: ControlMessageDebugHttp;
    mcp: ControlMcpService;
    releaseUpgrade: ReturnType<typeof createManagerUpgradeRelease>;
    upgradeIdentity: ReturnType<typeof createManagerUpgradeIdentity>;
    publisher: WindowsManagerStatusPublisher | undefined;
    activeAddress: () => GatewayProxyAddress | undefined;
    respondSnapshot: (
        response: ServerResponse,
        pathname: string,
        status: object,
        address: string | AddressInfo | null,
    ) => void;
    serverAddress: () => string | AddressInfo | null;
}

export function createControlRequestHandler(options: ControlRequestHandlerOptions) {
    return async function handle(
        request: IncomingMessage,
        response: ServerResponse,
        local: boolean,
    ) {
        try {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (request.method === "GET" && ["/ready", "/healthz"].includes(pathname)) {
                json(response, 200, {
                    application: "onebots",
                    version: options.manager.version,
                    instance_id: options.manager.id,
                    ready: true,
                });
                return;
            }
            if (pathname.startsWith("/api/")) {
                if (options.closed() && request.method === "POST") {
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
                const authentication = await handleControlAuthRequest(
                    request,
                    local,
                    options.auth,
                    options.mcp,
                );
                if (authentication) {
                    json(response, authentication.status, authentication.body);
                    return;
                }
                if (!local) {
                    const checked = authorizeControlHttp(
                        options.auth,
                        request,
                        response,
                        options.authAvailable(),
                    );
                    if (checked.storageUnavailable) options.markAuthUnavailable();
                    if (!checked.authorized) return;
                }
                const migration = await handleServiceMigrationRequest({
                    workspace: options.workspace,
                    ownershipAvailable: options.ownershipAvailable,
                    pathname,
                    method: request.method,
                    local,
                    body: () => readBody(request),
                    releaseUpgrade: options.releaseUpgrade,
                    upgradeIdentity: options.upgradeIdentity,
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
                        manager: { ...options.manager },
                        gateway: gatewayDiagnosticStatus(
                            options.controller.status(),
                            options.storageError(),
                        ),
                        authAvailable: options.authAvailable(),
                        processOwnership: { available: options.ownershipAvailable },
                        serviceMigration: serviceMigrationStatus(options.workspace),
                        generation: options.lifecycle.status(),
                        installationAvailable: Boolean(options.installation),
                        configuration: {
                            recoveryRequired:
                                options.configurationStorageUnavailable() ||
                                Boolean(
                                    options.configurationApplication?.health().recoveryRequired,
                                ),
                        },
                    };
                    options.respondSnapshot(response, pathname, status, options.serverAddress());
                    return;
                }
                if (
                    await respondControlSend(
                        options.sending,
                        request,
                        response,
                        pathname,
                        local,
                        options.auth,
                    )
                )
                    return;
                if (
                    respondControlLogs(
                        options.workspace,
                        request,
                        response,
                        pathname,
                        local,
                        options.auth,
                    )
                )
                    return;
                if (await options.verification.handle(request, response, pathname, local)) return;
                if (await options.messageDebugHttp.handle(request, response, pathname, local))
                    return;
                if (
                    await respondControlMcp(
                        options.mcp,
                        request,
                        response,
                        pathname,
                        local,
                        options.auth,
                    )
                )
                    return;
                if (isInstallationPath(pathname)) {
                    const address = request.socket.remoteAddress;
                    const result = await handleInstallationRequest({
                        pathname,
                        method: request.method,
                        body: () => readBody(request),
                        service: options.installation,
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
                        service: options.configuration,
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
                    if (options.storageError()) {
                        json(response, 503, { message: "控制状态不可读取，禁止修改" });
                        return;
                    }
                    const operation = await completeWindowsGatewayOperation(
                        async () => {
                            if (
                                options.controller.status().recoveryRequired &&
                                !options.driver.hasLiveChildren()
                            ) {
                                const prior = options.controller.status().instance;
                                if (prior?.pid && gatewayProcessExists(prior.pid))
                                    throw new Error("旧实例仍存在，拒绝重复启动");
                                if (!prior)
                                    throw new Error("前次启动结果未知，不能认定旧进程已退出");
                                if (!prior.pid)
                                    throw new Error("旧实例身份无法核实，需检查本地运行状态");
                                await options.lifecycle.reconcileStopped(state => {
                                    if (options.driver.hasLiveChildren()) return false;
                                    return state.instance?.pid
                                        ? !gatewayProcessExists(state.instance.pid)
                                        : false;
                                });
                            }
                            return action === "start"
                                ? options.lifecycle.start()
                                : action === "stop"
                                  ? options.lifecycle.stop()
                                  : options.lifecycle.restart();
                        },
                        () => options.controller.status(),
                        options.publisher,
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
            if (serveControlWeb(request, response, pathname, options.webRoot)) return;
            proxyGatewayHttp(request, response, options.activeAddress());
        } catch {
            if (!response.headersSent)
                json(response, 500, { message: "控制操作失败，请检查本地状态与日志" });
            else response.destroy();
        }
    };
}
