import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlAuth } from "./auth.js";
import {
    ControlVerificationService,
    type ControlVerificationServiceOptions,
} from "./verification-service.js";
import { ControlVerificationError } from "./verification-record.js";
import { jsonResponse, readBody } from "./http-utils.js";

/** 所有入口共用持久化验证服务，HTTP 不直接派发网关副作用。 */
export class ControlVerificationHttp {
    readonly service: ControlVerificationService;
    constructor(
        options: ControlVerificationServiceOptions,
        private readonly auth: ControlAuth,
    ) {
        this.service = new ControlVerificationService(options);
    }
    async handle(
        request: IncomingMessage,
        response: ServerResponse,
        pathname: string,
        local: boolean,
    ): Promise<boolean> {
        if (!pathname.startsWith("/api/control/verification/")) return false;
        const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const authorized = () => {
            try {
                return local || this.auth.verify(token);
            } catch {
                return false; /* 认证损坏时拒绝，不能仅凭历史会话放行。 */
            }
        };
        if (!authorized()) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        const owner = createHash("sha256")
            .update(local ? "local" : token)
            .digest("hex");
        let status = 200;
        let body: unknown;
        try {
            const match = /^\/api\/control\/verification\/operations\/([0-9a-f-]+)$/i.exec(
                pathname,
            );
            if (request.method === "GET" && pathname === "/api/control/verification/pending")
                body = await this.service.snapshot();
            else if (request.method === "GET" && match)
                body = this.service.operation(owner, match[1], local);
            else if (
                request.method === "POST" &&
                pathname === "/api/control/verification/execute"
            ) {
                const input = await readBody(request, 131072);
                if (!authorized()) {
                    jsonResponse(response, 401, { message: "控制认证失败" });
                    return true;
                }
                body = await this.service.execute(owner, input, authorized);
            } else {
                status = 404;
                body = { message: "账号验证接口不存在" };
            }
        } catch (error) {
            status = error instanceof ControlVerificationError ? error.httpStatus : 503;
            body = {
                code: "VERIFICATION_UNCONFIRMED",
                message: "验证操作未确认，请查询原操作回执，不要自动重新提交或发短信",
            };
        }
        if (!authorized()) jsonResponse(response, 401, { message: "控制认证失败" });
        else jsonResponse(response, status, body);
        return true;
    }
    close(): Promise<void> {
        return this.service.close();
    }
}
