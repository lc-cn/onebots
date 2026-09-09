import type { ControlAuth } from "./auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { controlLogSources, type ControlLogSource } from "@onebots/core/control";
import { jsonResponse } from "./http-utils.js";
import { readControlLog, readGatewayLog } from "./gateway-log.js";
/** 由宿主在本机身份或设备认证之后调用；同步读取不跨越授权检查。 */
export function respondControlLogs(
    workspace: string,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth: ControlAuth,
): boolean {
    if (!["/api/control/logs", "/api/control/logs/gateway"].includes(pathname)) return false;
    if (request.method !== "GET") {
        jsonResponse(response, 405, { message: "日志仅支持只读查询" });
        return true;
    }
    try {
        const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (!local && !auth.verify(token)) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (pathname === "/api/control/logs/gateway") {
            jsonResponse(response, 200, readGatewayLog(workspace));
            return true;
        }
        const parameters = new URL(request.url ?? "", "http://localhost").searchParams;
        const source = parameters.get("source") as ControlLogSource | null;
        const cursor = parameters.get("cursor") ?? undefined;
        const cursorMatch = cursor ? /^[a-f0-9]{16}\.([0-9]{1,16})$/u.exec(cursor) : undefined;
        if (
            !source ||
            !controlLogSources.includes(source) ||
            (cursor !== undefined &&
                (!cursorMatch || !Number.isSafeInteger(Number(cursorMatch[1])))) ||
            [...parameters.keys()].some(key => !["source", "cursor"].includes(key))
        ) {
            jsonResponse(response, 400, { message: "日志查询参数无效" });
            return true;
        }
        jsonResponse(response, 200, readControlLog(workspace, source, cursor));
    } catch {
        jsonResponse(response, 503, { message: "服务日志暂不可读取，请检查工作区权限" });
    }
    return true;
}
