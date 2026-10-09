import { openGatewayLog, appendGatewayLog } from "./gateway-log.js";
import { groupExists, gatewayEnvironment, isReady, waitForClose } from "./gateway-driver-state.js";
import { GatewayRequestClient, GatewayRequestError } from "./gateway-request-client.js";
import { AccountExploreError } from "../gateway/account-explore-errors.js";
import { requestGatewayMessageDebug } from "./gateway-message-debug-client.js";
import {
    applyRuntimeConfiguration,
    queryRuntimeConfiguration,
    runtimeContext,
} from "./gateway-driver-configuration.js";
import type {
    GatewayConfigurationInput,
    GatewayConfigurationResult,
} from "../gateway/configuration-contracts.js";
import {
    requestGatewayVerification,
    type GatewayVerificationOperation,
} from "./gateway-verification-client.js";
import type { GatewayVerificationReply } from "../gateway/verification-contracts.js";
import type { GatewayMessageDebugReply } from "../gateway/message-debug-contracts.js";
import type { GatewaySendResult } from "../gateway/send-contracts.js";
import { requestGatewaySend } from "./gateway-driver-send.js";
import {
    isControlSendContext,
    type ControlSendContext,
    type ControlSendRequest,
    type ControlAccountExploreRequest,
    type ControlAccountExploreResult,
} from "@onebots/core/control";
import { requestGatewayAccountExplore } from "./gateway-account-explore-client.js";
import { GatewayMcpClient } from "./gateway-mcp-client.js";
import type { GatewayMcpRequest, GatewayMcpResult } from "../gateway/mcp-contracts.js";
import { waitForProcessGroupExit } from "../process-group-exit.js";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
    GATEWAY_PROTOCOL_VERSION,
    isGatewayAccountStatusMessage,
    isGatewayDisconnectMessage,
    type GatewayAccountStatusMessage,
    type GatewayReadyMessage,
    type GatewayStartMessage,
} from "../gateway/contracts.js";
import {
    GatewayStartReapedError,
    type GatewayDriver,
    type GatewayInstance,
} from "./gateway-controller.js";

export interface GatewayPreparation {
    configPath: string;
    workspacePath: string;
    selection: GatewayStartMessage["selection"];
    configVersion: string;
    dependencyVersion: string;
    entrypoint: string;
    runtimeRoot: string;
}

export interface NodeGatewayDriverOptions {
    controlInstanceId: string;
    prepare(): Promise<GatewayPreparation>;
    onExit(instanceId: string, error?: string): void;
    onDisconnect?(account: { platform: string; accountId: string }): void;
    startupTimeoutMs?: number;
    stopTimeoutMs?: number;
}

interface ManagedChild {
    child: ChildProcess;
    id: string;
    closed: Promise<void>;
    exited: boolean;
    stopping: boolean;
    mcp?: GatewayMcpClient;
    requests?: GatewayRequestClient;
    sendContext?: ControlSendContext;
    messageDebug?: boolean;
    accountExplore?: boolean;
    verificationConfig?: string;
    configurationVersion?: string;
    accounts?: GatewayAccountStatusMessage["accounts"];
}

/** This is process lifecycle isolation, not a security sandbox for hostile plugins. */
export class NodeGatewayDriver implements GatewayDriver {
    private readonly children = new Map<string, ManagedChild>();
    private starting = false;

    constructor(private readonly options: NodeGatewayDriverOptions) {}

    hasLiveChildren(): boolean {
        return (
            this.starting ||
            [...this.children.values()].some(child => !child.exited || groupExists(child.child.pid))
        );
    }

    accountStatuses(instanceId: string): {
        available: boolean;
        items: NonNullable<ManagedChild["accounts"]>;
    } {
        const managed = this.children.get(instanceId);
        if (!managed || managed.stopping || managed.exited || !managed.accounts)
            return { available: false, items: [] };
        return { available: true, items: structuredClone(managed.accounts) };
    }

    async start(): Promise<GatewayInstance> {
        if (this.hasLiveChildren()) throw new Error("已有受管网关实例，不能重复启动");
        for (const [id, child] of this.children) {
            if (child.exited && !groupExists(child.child.pid)) this.children.delete(id);
        }
        this.starting = true;
        let managed: ManagedChild | undefined;
        try {
            const prepared = await this.options.prepare();
            const directory = join(prepared.workspacePath, ".control");
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const log = openGatewayLog(prepared.workspacePath);
            const id = randomUUID();
            let child: ChildProcess;
            try {
                child = fork(prepared.entrypoint, [], {
                    cwd: prepared.runtimeRoot,
                    execArgv: [],
                    detached: process.platform !== "win32",
                    env: gatewayEnvironment(),
                    stdio: ["ignore", log.fd, log.fd, "ipc"],
                });
                managed = this.track(child, id, prepared.workspacePath);
            } finally {
                await log.close();
            }
            const start: GatewayStartMessage = {
                type: "gateway.start",
                protocolVersion: GATEWAY_PROTOCOL_VERSION,
                controlInstanceId: this.options.controlInstanceId,
                gatewayInstanceId: id,
                configPath: prepared.configPath,
                workspacePath: prepared.workspacePath,
                selection: prepared.selection,
                configVersion: prepared.configVersion,
                dependencyVersion: prepared.dependencyVersion,
            };
            const ready = await this.handshake(managed, start);
            if (
                ready.capabilities?.includes("send") &&
                !isControlSendContext({
                    gatewayInstanceId: id,
                    configVersion: prepared.configVersion,
                })
            )
                throw new Error("发送网关上下文无效");
            managed.requests = new GatewayRequestClient(child);
            managed.messageDebug = ready.capabilities?.includes("message-debug") ?? false;
            managed.accountExplore = ready.capabilities?.includes("account-explore") ?? false;
            if (ready.capabilities?.includes("configuration"))
                managed.configurationVersion = prepared.configVersion;
            if (ready.capabilities?.includes("verification"))
                managed.verificationConfig = prepared.configVersion;
            if (ready.capabilities?.includes("send"))
                managed.sendContext = {
                    gatewayInstanceId: id,
                    configVersion: prepared.configVersion,
                };
            if (ready.capabilities?.includes("mcp"))
                managed.mcp = new GatewayMcpClient(managed.requests, {
                    protocolVersion: 1,
                    controlInstanceId: this.options.controlInstanceId,
                    gatewayInstanceId: id,
                });
            return { id, pid: child.pid, address: ready.address };
        } catch (error) {
            if (managed) await this.terminate(managed);
            // Windows 尚无受验收的进程树回收能力，不能把单个 child.close 升格为确认。
            if (managed && process.platform === "win32")
                throw new Error("当前平台无法确认网关进程树已回收");
            throw new GatewayStartReapedError(
                error instanceof Error ? error.message : "网关启动失败且已确认未留运行实例",
            );
        } finally {
            this.starting = false;
        }
    }

    runtimeContext(
        instanceId: string,
    ): { gatewayInstanceId: string; configVersion: string } | undefined {
        return runtimeContext(this.children.get(instanceId), instanceId);
    }
    async applyRuntimeConfiguration(
        input: GatewayConfigurationInput,
    ): Promise<GatewayConfigurationResult> {
        return applyRuntimeConfiguration(
            this.children.get(input.expected.gatewayInstanceId),
            this.options.controlInstanceId,
            input,
        );
    }
    queryRuntimeConfiguration(input: {
        id: string;
        expected: { gatewayInstanceId: string; configVersion: string };
    }): Promise<GatewayConfigurationResult> {
        return queryRuntimeConfiguration(
            this.children.get(input.expected.gatewayInstanceId),
            this.options.controlInstanceId,
            input,
        );
    }
    sendContext(instanceId: string): ControlSendContext | undefined {
        const managed = this.children.get(instanceId);
        return managed &&
            !managed.stopping &&
            !managed.exited &&
            managed.child.connected &&
            managed.child.exitCode === null &&
            managed.child.signalCode === null &&
            managed.sendContext
            ? { ...managed.sendContext }
            : undefined;
    }
    send(instanceId: string, request: ControlSendRequest): Promise<GatewaySendResult> {
        const context = this.sendContext(instanceId),
            managed = this.children.get(instanceId);
        if (
            !context ||
            !managed?.requests ||
            request.expected?.gatewayInstanceId !== context.gatewayInstanceId ||
            request.expected?.configVersion !== context.configVersion
        )
            return Promise.reject(new GatewayRequestError("rejected", "发送网关上下文不匹配"));
        const identity = {
            protocolVersion: 1 as const,
            controlInstanceId: this.options.controlInstanceId,
            gatewayInstanceId: instanceId,
        };
        return requestGatewaySend(managed.requests, identity, context, request);
    }

    exploreAccount(
        instanceId: string,
        request: ControlAccountExploreRequest,
    ): Promise<ControlAccountExploreResult> {
        const managed = this.children.get(instanceId);
        const context = this.sendContext(instanceId);
        if (!managed?.requests || !context)
            return Promise.reject(new AccountExploreError("gateway_unavailable"));
        if (!managed.accountExplore)
            return Promise.reject(new AccountExploreError("gateway_unsupported"));
        if (
            request.expected.gatewayInstanceId !== context.gatewayInstanceId ||
            request.expected.configVersion !== context.configVersion
        )
            return Promise.reject(new AccountExploreError("context_changed"));
        const identity = {
            protocolVersion: 1 as const,
            controlInstanceId: this.options.controlInstanceId,
            gatewayInstanceId: instanceId,
        };
        return requestGatewayAccountExplore(managed.requests, identity, context, request);
    }

    messageDebug(
        instanceId: string,
        action: "history" | "clear",
    ): Promise<GatewayMessageDebugReply> {
        const managed = this.children.get(instanceId);
        if (
            !managed ||
            managed.stopping ||
            managed.exited ||
            !managed.messageDebug ||
            !managed.requests
        )
            return Promise.reject(new GatewayRequestError("rejected", "消息调试网关不可用"));
        return requestGatewayMessageDebug(
            managed.requests,
            {
                protocolVersion: 1,
                controlInstanceId: this.options.controlInstanceId,
                gatewayInstanceId: instanceId,
            },
            action,
        );
    }

    verificationContext(
        instanceId: string,
    ): { gatewayInstanceId: string; configVersion: string } | undefined {
        const managed = this.children.get(instanceId);
        return managed && !managed.stopping && !managed.exited && managed.verificationConfig
            ? { gatewayInstanceId: instanceId, configVersion: managed.verificationConfig }
            : undefined;
    }

    verification(
        instanceId: string,
        operation: GatewayVerificationOperation,
    ): Promise<GatewayVerificationReply> {
        const managed = this.children.get(instanceId);
        if (
            !managed ||
            managed.stopping ||
            managed.exited ||
            !managed.requests ||
            !managed.verificationConfig
        )
            return Promise.reject(new GatewayRequestError("rejected", "账号验证网关不可用"));
        return requestGatewayVerification(
            managed.requests,
            {
                protocolVersion: 1,
                controlInstanceId: this.options.controlInstanceId,
                gatewayInstanceId: instanceId,
                configVersion: managed.verificationConfig,
            },
            operation,
        );
    }

    mcp(instanceId: string, request: GatewayMcpRequest): Promise<GatewayMcpResult> {
        const managed = this.children.get(instanceId);
        if (!managed || managed.stopping || managed.exited || !managed.mcp)
            return Promise.reject(new Error("MCP 网关不可用"));
        return managed.mcp.request(request);
    }

    async stop(instance: GatewayInstance): Promise<void> {
        const managed = this.children.get(instance.id);
        if (!managed) throw new Error("未持有该网关实例，不能按旧 PID 停机");
        if (managed.exited) {
            await this.terminate(managed);
            return;
        }
        managed.stopping = true;
        managed.requests?.close();
        if (managed.child.connected) {
            managed.child.send(
                {
                    type: "gateway.stop",
                    protocolVersion: GATEWAY_PROTOCOL_VERSION,
                    controlInstanceId: this.options.controlInstanceId,
                    gatewayInstanceId: instance.id,
                    timeoutMs: this.options.stopTimeoutMs ?? 10_000,
                },
                () => {
                    /* IPC failure is handled by timeout and process reaping below. */
                },
            );
        }
        await waitForClose(managed, this.options.stopTimeoutMs ?? 10_000);
        await this.terminate(managed);
    }

    private track(child: ChildProcess, id: string, workspace: string): ManagedChild {
        let finish!: () => void;
        const managed: ManagedChild = {
            child,
            id,
            exited: false,
            stopping: false,
            closed: new Promise(resolve => {
                finish = resolve;
            }),
        };
        this.children.set(id, managed);
        child.on("message", value => {
            if (
                isGatewayAccountStatusMessage(value) &&
                value.controlInstanceId === this.options.controlInstanceId &&
                value.gatewayInstanceId === id
            )
                managed.accounts = structuredClone(value.accounts);
            if (
                isGatewayDisconnectMessage(value) &&
                value.controlInstanceId === this.options.controlInstanceId &&
                value.gatewayInstanceId === id &&
                !managed.stopping &&
                !managed.exited
            )
                this.options.onDisconnect?.({
                    platform: value.platform,
                    accountId: value.accountId,
                });
        });
        // Keep an error listener even after handshake so late IPC errors are not unhandled.
        let processError: string | undefined;
        child.on("error", error => {
            processError = error.message;
        });
        child.once("close", (code, signal) => {
            managed.exited = true;
            managed.requests?.close();
            finish();
            const error = managed.stopping
                ? undefined
                : (processError ?? `网关进程退出 (code=${code}, signal=${signal ?? "none"})`);
            Promise.resolve()
                .then(() => this.terminate(managed))
                .then(() => this.options.onExit(id, error))
                .catch(() => {
                    try {
                        appendGatewayLog(workspace, "[onebots] 网关退出观察器处理失败\n");
                    } catch {
                        /* 日志失败不能撤销已经确认的子进程退出。 */
                    }
                });
        });
        return managed;
    }

    private handshake(
        managed: ManagedChild,
        start: GatewayStartMessage,
    ): Promise<GatewayReadyMessage> {
        return new Promise((resolve, reject) => {
            const child = managed.child;
            const cleanup = () => {
                clearTimeout(timer);
                child.off("message", onMessage);
                child.off("error", onError);
                child.off("close", onClose);
            };
            const fail = (error: Error) => {
                cleanup();
                reject(error);
            };
            const onError = (error: Error) => fail(error);
            const onClose = () => fail(new Error("网关在就绪握手前退出"));
            const onMessage = (value: unknown) => {
                if (!isReady(value, start)) {
                    fail(new Error("网关握手无效：身份、版本或监听地址不匹配"));
                    return;
                }
                cleanup();
                resolve(value);
            };
            const timer = setTimeout(
                () => fail(new Error("网关启动握手超时")),
                this.options.startupTimeoutMs ?? 30_000,
            );
            child.on("message", onMessage);
            child.once("error", onError);
            child.once("close", onClose);
            if (managed.exited) return onClose();
            child.send(start, error => {
                if (error) fail(error);
            });
        });
    }

    private async terminate(managed: ManagedChild): Promise<void> {
        managed.stopping = true;
        managed.requests?.close();
        const deadline = performance.now() + 7500;
        const remaining = (maximum: number) =>
            Math.max(0, Math.min(maximum, deadline - performance.now()));
        const signal = async (value: NodeJS.Signals) => {
            try {
                if (process.platform !== "win32" && managed.child.pid)
                    process.kill(-managed.child.pid, value);
                else if (!managed.exited) managed.child.kill(value);
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === "ESRCH") return;
                if (
                    code === "EPERM" &&
                    managed.child.pid &&
                    process.platform !== "win32" &&
                    (await waitForProcessGroupExit(managed.child.pid, remaining(2000))) === "exited"
                )
                    return;
                throw new Error("网关进程组清理失败，禁止启动新实例");
            }
        };
        if (!managed.exited || groupExists(managed.child.pid)) await signal("SIGTERM");
        if (!(await waitForClose(managed, remaining(500)))) {
            await signal("SIGKILL");
            if (!(await waitForClose(managed, remaining(5_000))))
                throw new Error("网关终止后仍未确认退出，禁止启动新实例");
        }
        if (groupExists(managed.child.pid)) await signal("SIGKILL");
        if (
            process.platform !== "win32" &&
            managed.child.pid &&
            (await waitForProcessGroupExit(managed.child.pid, remaining(2000))) !== "exited"
        )
            throw new Error("网关进程组仍未确认退出，禁止启动新实例");
    }
}
