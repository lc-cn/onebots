import type { ControlAuth } from "./auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "./http-utils.js";
import { readGatewayLog } from "./gateway-log.js";
/** 由宿主在本机身份或设备认证之后调用；同步读取不跨越授权检查。 */
export function respondControlLogs(
    workspace: string,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth: ControlAuth,
): boolean {
    if (pathname !== "/api/control/logs/gateway") return false;
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
        jsonResponse(response, 200, readGatewayLog(workspace));
    } catch {
        jsonResponse(response, 503, { message: "网关日志暂不可读取，请检查工作区权限" });
    }
    return true;
}
