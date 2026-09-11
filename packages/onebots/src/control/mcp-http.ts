import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlAuth } from "./auth.js";
import type { ControlMcpService } from "./mcp-api.js";
import { jsonResponse, readBody } from "./http-utils.js";

/** 已通过控制认证与维护门禁；响应前重新验证，避免撤销后的迟到结果泄露。 */
export async function respondControlMcp(
    service: ControlMcpService,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth?: ControlAuth,
): Promise<boolean> {
    if (!pathname.startsWith("/api/control/mcp/")) return false;
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const owner = local ? "local" : createHash("sha256").update(token).digest("hex");
    const result = await service.handle({
        pathname,
        method: request.method ?? "",
        owner,
        body: async () => {
            const body = await readBody(request, 65536);
            if (!local && !auth?.verify(token)) throw new Error("控制认证失败");
            return body;
        },
    });
    let authorized = local;
    try {
        if (!local) authorized = auth?.verify(token) ?? false;
    } catch {
        // 存储异常视为撤销，不返回可能包含账号数据的结果。
    }
    if (!authorized) {
        service.revokeOwner(owner);
        jsonResponse(response, 401, { message: "控制认证失败" });
    } else
        jsonResponse(
            response,
            result?.status ?? 404,
            result?.body ?? { message: "控制接口不存在" },
        );
    return true;
}
