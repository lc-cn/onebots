import { RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import type { App } from "../app.js";
import { startManagementAuthorizationMonitor } from "../management-authorization-monitor.js";
import { prepareManagementEventStream } from "../management-event-stream-response.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "../management-instance-precondition.js";

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
            app.logger.error("发送消息调试流身份失败", { error });
            ctx.res.end();
            return;
        }

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
        setManagementEvidenceIdentity(app, ctx);
        ctx.body = app.messageDebug.getHistory();
    });

    router.post("/api/message-debug/clear", (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        try {
            assertManagementInstancePrecondition(app, ctx, "消息调试清理");
            const receipt = app.messageDebug.clear();
            ctx.body = {
                success: true,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                cleared_count: receipt.clearedCount,
                cleared_through_seq: receipt.clearedThroughSeq,
            };
        } catch (error) {
            ctx.status =
                error instanceof ManagementInstanceMismatchError
                    ? 409
                    : error instanceof ValidationError
                      ? 400
                      : 500;
            ctx.body = {
                success: false,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                message: error instanceof Error ? error.message : "清空消息调试记录失败",
            };
            app.logger.error("清空消息调试记录失败", { error });
        }
    });
}
