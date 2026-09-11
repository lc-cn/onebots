import type { ControlAuth } from "./auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "./http-utils.js";

/** 只返回认证结论，不把 Token 或存储异常传给日志和响应。 */
export function checkControlAuthorization(auth: ControlAuth | undefined, header?: string) {
    try {
        return {
            authorized: auth?.verify((header ?? "").replace(/^Bearer\s+/i, "")) ?? false,
            storageUnavailable: false,
        };
    } catch {
        return { authorized: false, storageUnavailable: true };
    }
}

export function authorizeControlHttp(
    auth: ControlAuth | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    previouslyAvailable: boolean,
) {
    const checked = checkControlAuthorization(auth, request.headers.authorization);
    if (checked.storageUnavailable && previouslyAvailable)
        process.stderr.write("[onebots] 控制认证存储不可读取，远程请求已拒绝\n");
    if (!checked.authorized) jsonResponse(response, 401, { message: "控制认证失败" });
    return checked;
}
