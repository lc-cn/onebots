import type { RouterContext } from "@onebots/core";

/** 初始化受保护管理 SSE，禁止存储、内容转换与常见反向代理缓冲。 */
export function prepareManagementEventStream(ctx: RouterContext): void {
    ctx.request.socket.setTimeout(0);
    ctx.req.socket.setNoDelay(true);
    ctx.req.socket.setKeepAlive(true);
    ctx.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    ctx.status = 200;
    ctx.respond = false;
}
