import { RouterContext } from "@onebots/core";
import type { Router } from "@onebots/core";
import type { App } from "../app.js";
import { startManagementAuthorizationMonitor } from "../management-authorization-monitor.js";

/**
 * Register message-debug routes: a live view of inbound events (raw CommonEvent
 * received from adapters) and outbound protocol dispatches (converted payload
 * sent to each connected protocol client), for diagnosing adapter/protocol bugs.
 *
 * Routes:
 *  GET   /api/message-debug/stream   — SSE endpoint; pushes new entries as they occur
 *  GET   /api/message-debug/history  — recent buffered entries (page load / reconnect)
 *  POST  /api/message-debug/clear    — clear the in-memory buffer
 */
export function registerMessageDebugRoutes(app: App, router: Router): void {
    router.get("/api/message-debug/stream", (ctx: RouterContext) => {
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

        const stopAuthorizationMonitor = startManagementAuthorizationMonitor(
            app,
            ctx.state.token as string | undefined,
            {
                onAuthorized: () => {
                    try {
                        ctx.res.write(": heartbeat\n\n");
                    } catch (error) {
                        app.logger.error("发送消息调试流心跳失败", { error });
                        app.messageDebug.removeClient(ctx.res);
                    }
                },
                onUnauthorized: () => {
                    app.messageDebug.removeClient(ctx.res);
                    ctx.res.end();
                },
            },
        );
        app.messageDebug.registerClient(ctx.res, stopAuthorizationMonitor);

        ctx.req.on("close", () => {
            app.messageDebug.removeClient(ctx.res);
        });
    });

    router.get("/api/message-debug/history", (ctx: RouterContext) => {
        ctx.body = app.messageDebug.getHistory();
    });

    router.post("/api/message-debug/clear", (ctx: RouterContext) => {
        app.messageDebug.clear();
        ctx.body = { success: true };
    });
}
