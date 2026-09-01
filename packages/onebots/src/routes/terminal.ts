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
import { TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES } from "../management-websocket.js";

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
    });
    terminalWs.on("connection", (client, request) => {
        client.on("error", error => {
            app.logger.warn("终端 WebSocket 连接错误", { error });
        });
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
                    try {
                        c.send(JSON.stringify({ type: "output", data }));
                    } catch {
                        app.terminalClients.delete(c);
                    }
                });
            });

            // 监听 PTY 退出
            app.ptyTerminal.onExit(() => {
                app.ptyTerminal = null;
                app.terminalClients.forEach(c => {
                    try {
                        c.send(JSON.stringify({ type: "exit" }));
                    } catch {
                        // 客户端可能已断开，将在后续连接清理中移除
                    }
                });
                app.terminalClients.clear();
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
            try {
                const payload = JSON.parse(msg.toString());
                if (payload.type === "input" && app.ptyTerminal) {
                    app.ptyTerminal.write(payload.data);
                } else if (payload.type === "resize" && app.ptyTerminal) {
                    app.ptyTerminal.resize(payload.cols, payload.rows);
                } else if (payload.type === "restart") {
                    void requestTerminalRestart(app);
                }
            } catch (e) {
                app.logger.error("终端消息处理失败:", e);
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
        ctx.request.socket.setTimeout(0);
        ctx.req.socket.setNoDelay(true);
        ctx.req.socket.setKeepAlive(true);
        ctx.set({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        ctx.status = 200;
        ctx.respond = false;

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
        try {
            client.send(JSON.stringify({ type: "output", data }));
        } catch {
            // 客户端可能已断开，后续 close 事件会完成清理。
        }
    });
}
