import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlAuth } from "./auth.js";
import { ControlSendError, type ControlSendService } from "./send-service.js";
import { jsonResponse, readBody } from "./http-utils.js";

/** 宿主已检查认证及维护门禁；读取消息后和返回结果前再次检查撤销状态。 */
export async function respondControlSend(
    service: ControlSendService | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth?: ControlAuth,
): Promise<boolean> {
    if (!pathname.startsWith("/api/control/messages/")) return false;
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const owner = createHash("sha256")
        .update(local ? "local" : token)
        .digest("hex");
    const authorized = () => {
        try {
            return local || Boolean(auth?.verify(token));
        } catch {
            return false; /* 认证存储异常不得放行。 */
        }
    };
    let status = 200;
    let body: unknown;
    try {
        if (!service) throw new Error("发送控制存储不可用");
        const operation = /^\/api\/control\/messages\/operations\/([0-9a-f-]+)$/i.exec(pathname);
        if (request.method === "GET" && pathname === "/api/control/messages/context") {
            body = service.context();
        } else if (request.method === "GET" && operation) {
            body = service.operation(owner, operation[1], local);
        } else if (request.method === "POST" && pathname === "/api/control/messages/send") {
            const input = await readBody(request, 65536);
            if (!authorized()) {
                jsonResponse(response, 401, { message: "控制认证失败" });
                return true;
            }
            body = await service.send(owner, input);
        } else {
            status = 404;
            body = { message: "发送控制接口不存在" };
        }
    } catch (error) {
        status = error instanceof ControlSendError ? error.httpStatus : 503;
        body = { message: "发送操作未确认，请按操作标识查询结果，勿自动重发" };
    }
    if (!authorized()) jsonResponse(response, 401, { message: "控制认证失败" });
    else jsonResponse(response, status, body);
    return true;
}
