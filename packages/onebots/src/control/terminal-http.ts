import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlTerminalService } from "./terminal-service.js";
import { jsonResponse } from "./http-utils.js";
import { isLocalTerminalRequest } from "./terminal-request.js";

const STATUS_PATH = "/api/control/terminal/status";
const TICKET_PATH = "/api/control/terminal/ticket";

export function isTerminalHttpPath(pathname: string): boolean {
    return pathname === STATUS_PATH || pathname === TICKET_PATH;
}

/** HTTP 认证已由控制宿主完成；只签发短期、单次使用的 WebSocket 票据。 */
export function handleTerminalHttp(
    terminal: ControlTerminalService,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
): void {
    if (pathname === STATUS_PATH && request.method === "GET") {
        const status = terminal.status();
        jsonResponse(response, 200, {
            ...status,
            available: status.available && isLocalTerminalRequest(request, local),
        });
        return;
    }
    if (pathname === TICKET_PATH && request.method === "POST") {
        if (!isLocalTerminalRequest(request, local)) {
            jsonResponse(response, 403, { message: "本地终端只能从服务所在设备打开" });
            return;
        }
        try {
            jsonResponse(response, 201, terminal.issueTicket());
        } catch {
            jsonResponse(response, 503, { message: "本地终端当前不可用" });
        }
        return;
    }
    jsonResponse(response, 405, { message: "终端接口方法无效" });
}
