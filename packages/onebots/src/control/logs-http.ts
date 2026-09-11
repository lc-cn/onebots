import type { ControlAuth } from "./auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { controlLogSources, type ControlLogSource } from "@onebots/core/control";
import { jsonResponse } from "./http-utils.js";
import { readControlLog, readGatewayLog } from "./gateway-log.js";

const STREAM_PATH = "/api/control/logs/stream";
const STREAM_INTERVAL_MS = 500;

function authorized(request: IncomingMessage, local: boolean, auth: ControlAuth): boolean {
    if (local) return true;
    try {
        const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        return auth.verify(token);
    } catch {
        return false;
    }
}

function query(
    request: IncomingMessage,
): { source: ControlLogSource; cursor?: string } | undefined {
    const parameters = new URL(request.url ?? "", "http://localhost").searchParams;
    const source = parameters.get("source") as ControlLogSource | null;
    const cursor = parameters.get("cursor") ?? undefined;
    const cursorMatch = cursor ? /^[a-f0-9]{16}\.([0-9]{1,16})$/u.exec(cursor) : undefined;
    if (
        !source ||
        !controlLogSources.includes(source) ||
        (cursor !== undefined && (!cursorMatch || !Number.isSafeInteger(Number(cursorMatch[1])))) ||
        [...parameters.keys()].some(key => !["source", "cursor"].includes(key))
    )
        return undefined;
    return { source, ...(cursor ? { cursor } : {}) };
}

function streamControlLogs(
    workspace: string,
    request: IncomingMessage,
    response: ServerResponse,
    initial: { source: ControlLogSource; cursor?: string },
    local: boolean,
    auth: ControlAuth,
): void {
    let stopped = false;
    let busy = false;
    let cursor = initial.cursor;
    let exists: boolean | undefined;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        request.off("aborted", stop);
        response.off("close", stop);
        response.off("error", stop);
        response.destroy();
    };
    const poll = () => {
        if (stopped || busy) return;
        if (!authorized(request, local, auth) || response.destroyed) return stop();
        busy = true;
        try {
            const batch = readControlLog(workspace, initial.source, cursor);
            const first = exists === undefined;
            const changed = batch.text.length > 0 || batch.reset || batch.exists !== exists;
            cursor = batch.cursor;
            exists = batch.exists;
            if (
                (first || changed) &&
                !response.write(`event: logs\ndata: ${JSON.stringify(batch)}\n\n`)
            )
                stop();
        } catch {
            stop();
        } finally {
            busy = false;
        }
    };
    const timer = setInterval(poll, STREAM_INTERVAL_MS);
    timer.unref();
    request.once("aborted", stop);
    response.once("close", stop);
    response.once("error", stop);
    try {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        poll();
    } catch {
        stop();
    }
}
/** 由宿主在本机身份或设备认证之后调用；同步读取不跨越授权检查。 */
export function respondControlLogs(
    workspace: string,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth: ControlAuth,
): boolean {
    if (!["/api/control/logs", "/api/control/logs/gateway", STREAM_PATH].includes(pathname))
        return false;
    if (request.method !== "GET") {
        jsonResponse(response, 405, { message: "日志仅支持只读查询" });
        return true;
    }
    try {
        if (!authorized(request, local, auth)) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (pathname === "/api/control/logs/gateway") {
            jsonResponse(response, 200, readGatewayLog(workspace));
            return true;
        }
        const parsed = query(request);
        if (!parsed) {
            jsonResponse(response, 400, { message: "日志查询参数无效" });
            return true;
        }
        if (pathname === STREAM_PATH) {
            streamControlLogs(workspace, request, response, parsed, local, auth);
            return true;
        }
        jsonResponse(response, 200, readControlLog(workspace, parsed.source, parsed.cursor));
    } catch {
        jsonResponse(response, 503, { message: "服务日志暂不可读取，请检查工作区权限" });
    }
    return true;
}
