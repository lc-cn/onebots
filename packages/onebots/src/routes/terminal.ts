import { RouterContext } from "@onebots/core";
import type { Router } from "@onebots/core";
import * as pty from "@karinjs/node-pty";
import { existsSync, readFileSync } from "fs";
import type { App } from "../app.js";

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
    const expectedAccessToken: string | undefined = (
        (app.config as { access_token?: string }).access_token?.trim()
        || process.env.ONEBOTS_ACCESS_TOKEN?.trim()
        || undefined
    );

    /** Extract a Bearer token or ?access_token from an http.IncomingMessage. */
    const getTokenFromRequest = (request: import('http').IncomingMessage): string | undefined => {
        const authHeader = request.headers.authorization;
        if (authHeader && typeof authHeader === 'string') {
            const match = authHeader.match(/^Bearer\s+(.+)$/i);
            return match ? match[1] : authHeader;
        }
        try {
            const url = new URL(request.url || '/', 'http://localhost');
            return url.searchParams.get('access_token') || undefined;
        } catch {
            return undefined;
        }
    };

    /* ── PTY 终端 WebSocket ────────────────────────────────────── */

    const terminalWs = router.ws("/api/terminal");
    terminalWs.on("connection", (client, request) => {
        const token = getTokenFromRequest(request);
        const valid = !!token && (
            expectedAccessToken
                ? token === expectedAccessToken
                : app.tokenManager.validateToken(token).valid
        );
        if (!valid) {
            client.close(1008, "Unauthorized");
            return;
        }

        // 创建 PTY 终端实例（如果不存在）
        if (!app.ptyTerminal) {
            const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
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
                app.terminalClients.forEach((c: any) => {
                    try {
                        c.send(JSON.stringify({ type: 'output', data }));
                    } catch (e) {
                        app.terminalClients.delete(c);
                    }
                });
            });

            // 监听 PTY 退出
            app.ptyTerminal.onExit(() => {
                app.ptyTerminal = null;
                app.terminalClients.forEach((c: any) => {
                    try {
                        c.send(JSON.stringify({ type: 'exit' }));
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
            try {
                const payload = JSON.parse(msg.toString());
                if (payload.type === 'input' && app.ptyTerminal) {
                    app.ptyTerminal.write(payload.data);
                } else if (payload.type === 'resize' && app.ptyTerminal) {
                    app.ptyTerminal.resize(payload.cols, payload.rows);
                } else if (payload.type === 'restart') {
                    // 通知所有客户端
                    app.terminalClients.forEach((c: any) => {
                        try {
                            c.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[33m[服务即将重启]\x1b[0m' }));
                        } catch {
                            // 客户端可能已断开，忽略
                        }
                    });
                    setTimeout(() => process.exit(100), TERMINAL_RESTART_DELAY_MS);
                }
            } catch (e) {
                app.logger.error('终端消息处理失败:', e);
            }
        });

        // 监听客户端断开
        client.on("close", () => {
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
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        ctx.status = 200;
        ctx.respond = false;

        app.logClients.add(ctx.res);

        // 发送缓存日志到客户端
        try {
            if (existsSync(app.logCacheFile)) {
                const cachedLogs = readFileSync(app.logCacheFile, 'utf-8');
                if (cachedLogs) {
                    // 将历史日志的 \n 也替换为 \r\n
                    const terminalLogs = cachedLogs.replace(/\n/g, '\r\n');
                    ctx.res.write(`data: ${JSON.stringify({ message: terminalLogs })}\n\n`);
                }
            }
        } catch (error) {
            app.logger.error('读取日志缓存失败:', error);
        }

        // 定时发送心跳
        const heartbeat = setInterval(() => {
            try {
                ctx.res.write(': heartbeat\n\n');
            } catch (error) {
                clearInterval(heartbeat);
                app.logClients.delete(ctx.res);
            }
        }, SSE_HEARTBEAT_INTERVAL_MS);

        // 监听连接关闭
        ctx.req.on('close', () => {
            clearInterval(heartbeat);
            app.logClients.delete(ctx.res);
        });
    });
}
