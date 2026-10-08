import type { IncomingMessage, ServerResponse } from "node:http";
import {
    isControlAccountExploreRequest,
    type ControlSendContext,
    type ControlAccountExploreRequest,
    type ControlAccountExploreResult,
} from "@onebots/core/control";
import type { ControlAuth } from "./auth.js";
import { jsonResponse, readBody } from "./http-utils.js";
import { AccountExploreError, ACCOUNT_EXPLORE_ERRORS } from "../gateway/account-explore-errors.js";

export interface AccountExploreSource {
    context(): ControlSendContext | undefined;
    explore(request: ControlAccountExploreRequest): Promise<ControlAccountExploreResult>;
}

export async function respondControlAccountExplore(
    source: AccountExploreSource,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth?: ControlAuth,
): Promise<boolean> {
    if (pathname !== "/api/control/accounts/explore") return false;
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const authorized = () => local || Boolean(auth?.verify(token));
    if (request.method !== "POST") {
        jsonResponse(response, 405, { message: "账号查询仅支持 POST" });
        return true;
    }
    try {
        const input: unknown = await readBody(request, 4096);
        if (!authorized()) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (!isControlAccountExploreRequest(input)) {
            jsonResponse(response, 400, { message: "账号查询参数无效" });
            return true;
        }
        const context = source.context();
        if (!context) {
            jsonResponse(response, 503, { message: "运行网关不可用" });
            return true;
        }
        if (
            context.gatewayInstanceId !== input.expected.gatewayInstanceId ||
            context.configVersion !== input.expected.configVersion
        ) {
            jsonResponse(response, 409, { message: "网关实例已变化，请刷新账号页面" });
            return true;
        }
        const result = await source.explore(input);
        if (!authorized()) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (source.context()?.gatewayInstanceId !== context.gatewayInstanceId) {
            jsonResponse(response, 409, { message: "网关实例已变化，请刷新账号页面" });
            return true;
        }
        jsonResponse(response, 200, result);
    } catch (error) {
        if (!response.headersSent) {
            const code = error instanceof AccountExploreError ? error.code : "query_failed";
            const failure = ACCOUNT_EXPLORE_ERRORS[code];
            jsonResponse(response, failure.status, { code, message: failure.message });
        }
    }
    return true;
}
