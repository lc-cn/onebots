import { GatewayRequestClient, GatewayRequestError } from "./gateway-request-client.js";
import { requestGatewayMessageDebug } from "./gateway-message-debug-client.js";
import {
    requestGatewayVerification,
    type GatewayVerificationOperation,
} from "./gateway-verification-client.js";
import type { GatewayVerificationReply } from "../gateway/verification-contracts.js";
import type { GatewayMessageDebugReply } from "../gateway/message-debug-contracts.js";
import {
    isGatewaySendMessage,
    isGatewaySendReply,
    type GatewaySendResult,
} from "../gateway/send-contracts.js";
import {
    isControlSendContext,
    type ControlSendContext,
    type ControlSendRequest,
} from "@onebots/core/control";
import { GatewayMcpClient } from "./gateway-mcp-client.js";
import type { GatewayMcpRequest, GatewayMcpResult } from "../gateway/mcp-contracts.js";
import { waitForProcessGroupExit } from "../process-group-exit.js";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import {
    GATEWAY_PROTOCOL_VERSION,
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
    verificationConfig?: string;
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
            const logPath = join(directory, "gateway.log");
            const log = await open(logPath, "a", 0o600);
            const id = randomUUID();
            let child: ChildProcess;
            try {
                await log.chmod(0o600);
                child = fork(prepared.entrypoint, [], {
                    cwd: prepared.runtimeRoot,
                    execArgv: [],
                    detached: process.platform !== "win32",
                    env: gatewayEnvironment(),
                    stdio: ["ignore", log.fd, log.fd, "ipc"],
                });
                managed = this.track(child, id, logPath);
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
        return managed.requests.request({
            encode: requestId => {
                const message = { ...identity, type: "gateway.send" as const, requestId, request };
                if (!isGatewaySendMessage(message)) throw new Error();
                return message;
            },
            decode: (value, requestId) => {
                if (
                    !isGatewaySendReply(value) ||
                    value.requestId !== requestId ||
                    value.controlInstanceId !== identity.controlInstanceId ||
                    value.gatewayInstanceId !== instanceId ||
                    value.configVersion !== context.configVersion ||
                    value.operationId !== request.id
                )
                    return;
                return value.outcome === "succeeded"
                    ? { ok: true, result: value.result! }
                    : {
                          ok: false,
                          error: new GatewayRequestError(
                              value.outcome,
                              value.outcome === "rejected"
                                  ? "网关拒绝发送请求"
                                  : "消息发送结果未知，请勿自动重试",
                          ),
                      };
            },
            errors: {
                unavailable: "发送网关不可用",
                limit: "未完成网关请求已达上限",
                invalid: "发送请求无效",
                timeout: "消息发送超时，结果未知，请勿自动重试",
                send: "发送通信中断，结果未知，请勿自动重试",
                closed: "发送网关已关闭，结果未知，请勿自动重试",
            },
        });
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

    private track(child: ChildProcess, id: string, logPath: string): ManagedChild {
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
                    void appendFile(logPath, "[onebots] 网关退出观察器处理失败\n").catch(() => {
                        // A broken observer/log sink must not undo confirmed child reaping.
                    });
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

function groupExists(pid: number | undefined): boolean {
    if (!pid || process.platform === "win32") return false;
    try {
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
}

function gatewayEnvironment(): NodeJS.ProcessEnv {
    const result: NodeJS.ProcessEnv = {};
    for (const key of [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "TZ",
    ]) {
        if (process.env[key] !== undefined) result[key] = process.env[key];
    }
    result.NODE_ENV = "production";
    return result;
}

function isReady(value: unknown, start: GatewayStartMessage): value is GatewayReadyMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<GatewayReadyMessage>;
    return (
        message.type === "gateway.ready" &&
        message.protocolVersion === GATEWAY_PROTOCOL_VERSION &&
        message.controlInstanceId === start.controlInstanceId &&
        message.gatewayInstanceId === start.gatewayInstanceId &&
        message.configVersion === start.configVersion &&
        message.dependencyVersion === start.dependencyVersion &&
        (message.capabilities === undefined ||
            (Array.isArray(message.capabilities) &&
                message.capabilities.length <= 4 &&
                new Set(message.capabilities).size === message.capabilities.length &&
                message.capabilities.every(
                    value =>
                        value === "mcp" ||
                        value === "send" ||
                        value === "message-debug" ||
                        value === "verification",
                ))) &&
        message.address?.host === "127.0.0.1" &&
        Number.isInteger(message.address.port) &&
        message.address.port > 0 &&
        message.address.port <= 65535
    );
}

async function waitForClose(managed: ManagedChild, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            managed.closed.then(() => true),
            new Promise<boolean>(resolve => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
