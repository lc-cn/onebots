import { RouterContext } from "@onebots/core";
import type { Router } from "@onebots/core";
import * as pty from "@karinjs/node-pty";
import { existsSync, readFileSync } from "fs";
import type { App } from "../app.js";
import {
    authorizeManagementUpgrade,
    extractManagementToken,
    validateManagementToken,
} from "../management-auth.js";
import { startManagementAuthorizationMonitor } from "../management-authorization-monitor.js";
import { scheduleProcessRestart } from "../process-restart.js";
import {
    TERMINAL_WEBSOCKET_MAX_CONNECTIONS,
    TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
    sendTerminalWebSocketJson,
    type BoundedWebSocketSendResult,
} from "../management-websocket.js";
import { WebSocket } from "ws";
import { parseTerminalClientMessage } from "../terminal-message.js";
import { prepareManagementEventStream } from "../management-event-stream-response.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";

/** SSE 心跳间隔（毫秒） */
const SSE_HEARTBEAT_INTERVAL_MS = 30000;

/** 终端重启延迟（毫秒） */
const TERMINAL_RESTART_DELAY_MS = 500;

/**
 * Register terminal and log-streaming endpoints.
 *
 *  WS  /api/terminal  — interactive PTY terminal via WebSocket
 *  SSE /api/logs      — real-time log stream (stdout / stderr interception)
 */
export function registerTerminalRoutes(app: App, router: Router): void {
    /* ── PTY 终端 WebSocket ────────────────────────────────────── */

    const terminalWs = router.ws("/api/terminal", {
        authorize: request => authorizeManagementUpgrade(app, request),
        maxPayloadBytes: TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
        maxConnections: TERMINAL_WEBSOCKET_MAX_CONNECTIONS,
    });
    terminalWs.on("connection", (client, request) => {
        client.on("error", error => {
            app.logger.warn("终端 WebSocket 连接错误", { error });
        });
        if (!sendTerminalIdentity(app, client)) {
            if (client.readyState === WebSocket.OPEN)
                client.close(1011, "Identity handshake failed");
            return;
        }
        const managementToken = extractManagementToken(request);
        const stopAuthorizationMonitor = startManagementAuthorizationMonitor(app, managementToken, {
            onUnauthorized: () => client.close(1008, "Unauthorized"),
        });
        // 创建 PTY 终端实例（如果不存在）
        if (!app.ptyTerminal) {
            const shell = process.platform === "win32" ? "powershell.exe" : "bash";
            app.ptyTerminal = pty.spawn(shell, [], {
                name: "xterm-color",
                cols: 80,
                rows: 30,
                cwd: process.env.HOME,
                env: process.env,
            });

            // 监听 PTY 输出
            app.ptyTerminal.onData((data: string) => {
                // 广播到所有连接的客户端
                app.terminalClients.forEach(c => {
                    if (!sendTerminalMessage(app, c, { type: "output", data }, "终端输出"))
                        app.terminalClients.delete(c);
                });
            });

            // 监听 PTY 退出
            app.ptyTerminal.onExit(() => {
                handleTerminalProcessExit(app);
            });
        }

        // 添加到客户端列表
        app.terminalClients.add(client);

        // 监听客户端消息（用户输入）
        client.on("message", (msg: Buffer) => {
            if (!validateManagementToken(app, managementToken).valid) {
                client.close(1008, "Unauthorized");
                return;
            }
            const result = parseTerminalClientMessage(msg.toString());
            if ("error" in result) {
                sendTerminalMessage(app, client, result.error, "终端输入错误回执");
                return;
            }
            const command = result.command;
            if (command.type === "restart") {
                void requestTerminalRestart(app);
                return;
            }
            if (!app.ptyTerminal) {
                sendTerminalMessage(
                    app,
                    client,
                    { type: "error", code: "TERMINAL_UNAVAILABLE", message: "终端进程不可用" },
                    "终端不可用回执",
                );
                return;
            }
            if (command.type === "input") {
                app.ptyTerminal.write(command.data);
            } else {
                app.ptyTerminal.resize(command.cols, command.rows);
            }
        });

        // 监听客户端断开
        client.on("close", () => {
            stopAuthorizationMonitor();
            app.terminalClients.delete(client);
            // 如果没有客户端了，关闭 PTY
            if (app.terminalClients.size === 0 && app.ptyTerminal) {
                app.ptyTerminal.kill();
                app.ptyTerminal = null;
            }
        });
    });

    /* ── 日志流 SSE ───────────────────────────────────────────── */

    router.get("/api/logs", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        prepareManagementEventStream(ctx);
        try {
            ctx.res.write(
                `data: ${JSON.stringify({
                    event: "identity",
                    application: app.info.application_name,
                    version: app.info.application_version,
                    instance_id: app.info.instance_id,
                    ...(app.runtimeContractId
                        ? { runtime_contract_id: app.runtimeContractId }
                        : {}),
                })}\n\n`,
            );
        } catch (error) {
            app.logger.error("发送日志流身份失败", { error });
            ctx.res.end();
            return;
        }

        // 发送缓存日志到客户端
        try {
            if (existsSync(app.logCacheFile)) {
                const cachedLogs = readFileSync(app.logCacheFile, "utf-8");
                if (cachedLogs) {
                    // 将历史日志的 \n 也替换为 \r\n
                    const terminalLogs = cachedLogs.replace(/\n/g, "\r\n");
                    ctx.res.write(`data: ${JSON.stringify({ message: terminalLogs })}\n\n`);
                }
            }
        } catch (error) {
            app.logger.error("读取日志缓存失败:", error);
        }

        const stopAuthorizationMonitor = startManagementAuthorizationMonitor(
            app,
            ctx.state.token as string | undefined,
            {
                intervalMs: SSE_HEARTBEAT_INTERVAL_MS,
                onAuthorized: () => {
                    try {
                        ctx.res.write(": heartbeat\n\n");
                    } catch (error) {
                        app.logger.error("发送日志流心跳失败", { error });
                        app.removeLogClient(ctx.res);
                    }
                },
                onUnauthorized: () => {
                    app.removeLogClient(ctx.res);
                    ctx.res.end();
                },
            },
        );
        app.registerLogClient(ctx.res, stopAuthorizationMonitor);

        // 监听连接关闭
        ctx.req.on("close", () => {
            app.removeLogClient(ctx.res);
        });
    });
}

/** PTY 退出后关闭仍存活的客户端，使浏览器进入统一的重连路径。 */
export function handleTerminalProcessExit(app: App): void {
    app.ptyTerminal = null;
    app.terminalClients.forEach(client => {
        sendTerminalMessage(app, client, { type: "exit" }, "终端退出事件");
        client.close(1000, "Terminal exited");
    });
    app.terminalClients.clear();
}

/** 终端在创建 PTY 或接受命令前先声明实际处理进程。 */
export function sendTerminalIdentity(app: App, client: WebSocket): boolean {
    return sendTerminalMessage(
        app,
        client,
        {
            type: "identity",
            application: app.info.application_name,
            version: app.info.application_version,
            instance_id: app.info.instance_id,
            ...(app.runtimeContractId ? { runtime_contract_id: app.runtimeContractId } : {}),
        },
        "终端实例身份",
    );
}

async function requestTerminalRestart(app: App): Promise<void> {
    try {
        await app.preflightRestart();
        const scheduled = scheduleProcessRestart(app, {
            exitCode: 100,
            delayMs: TERMINAL_RESTART_DELAY_MS,
        });
        broadcastTerminalOutput(
            app,
            scheduled
                ? "\r\n\x1b[33m[重启预检通过，服务正在优雅停止]\x1b[0m"
                : "\r\n\x1b[33m[服务重启已在进行中]\x1b[0m",
        );
    } catch (error) {
        app.logger.error("终端重启预检失败，当前服务继续运行", { error });
        broadcastTerminalOutput(
            app,
            `\r\n\x1b[31m[重启预检失败：${error instanceof Error ? error.message : String(error)}]\x1b[0m`,
        );
    }
}

function broadcastTerminalOutput(app: App, data: string): void {
    app.terminalClients.forEach(client => {
        if (!sendTerminalMessage(app, client, { type: "output", data }, "终端状态事件"))
            app.terminalClients.delete(client);
    });
}

function sendTerminalMessage(
    app: App,
    client: WebSocket,
    payload: unknown,
    context: string,
): boolean {
    const result = sendTerminalWebSocketJson(client, payload, error => {
        app.terminalClients.delete(client);
        app.logger.error(`${context}发送失败`, { error });
    });
    return handleTerminalSendResult(app, result, context);
}

function handleTerminalSendResult(
    app: App,
    result: BoundedWebSocketSendResult,
    context: string,
): boolean {
    switch (result.status) {
        case "sent":
            return true;
        case "not-open":
            return false;
        case "message-too-large":
            app.logger.warn(`${context}超过终端 WebSocket 单消息上限，连接已关闭`, {
                bytes: result.bytes,
            });
            return false;
        case "backpressure":
            app.logger.warn(`${context}遇到慢客户端，终端 WebSocket 连接已关闭`, {
                bytes: result.bytes,
                bufferedBytes: result.bufferedBytes,
            });
            return false;
        case "serialization-failed":
            app.logger.error(`${context}序列化失败`, { error: result.error });
            return false;
        case "send-failed":
            app.logger.error(`${context}发送失败`, { error: result.error });
            return false;
    }
}
