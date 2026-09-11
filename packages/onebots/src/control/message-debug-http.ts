import type { IncomingMessage, ServerResponse } from "node:http";
import type { MessageDebugEntry } from "../gateway/message-debug-types.js";
import type { ControlAuth } from "./auth.js";
import { jsonResponse, readBody } from "./http-utils.js";

export interface ControlMessageDebugHttpService {
    history(): Promise<{ gatewayInstanceId: string; entries: MessageDebugEntry[] }>;
    clear(input: unknown): Promise<{
        gatewayInstanceId: string;
        clearedCount: number;
        clearedThroughSeq: number;
    }>;
}

/** 管理宿主拥有流的生命周期；设备撤销和网关停止均不留下后台轮询。 */
export class ControlMessageDebugHttp {
    private readonly streams = new Set<() => void>();
    private closed = false;

    constructor(
        private readonly service: ControlMessageDebugHttpService | undefined,
        private readonly auth?: ControlAuth,
    ) {}

    close(): void {
        this.closed = true;
        for (const stop of [...this.streams]) stop();
    }

    async handle(
        request: IncomingMessage,
        response: ServerResponse,
        pathname: string,
        local: boolean,
    ): Promise<boolean> {
        if (!pathname.startsWith("/api/control/message-debug/")) return false;
        const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const authorized = () => {
            try {
                return local || Boolean(this.auth?.verify(token));
            } catch {
                return false; // 认证存储故障必须关闭访问。
            }
        };
        if (!authorized()) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (this.closed || !this.service) {
            jsonResponse(response, 503, { message: "消息调试服务不可用" });
            return true;
        }
        if (pathname === "/api/control/message-debug/stream" && request.method === "GET") {
            if (this.streams.size >= 16) {
                jsonResponse(response, 429, { message: "消息调试连接已达上限" });
            } else this.stream(request, response, authorized);
            return true;
        }
        let status = 200;
        let body: unknown;
        try {
            if (pathname === "/api/control/message-debug/history" && request.method === "GET") {
                body = await this.service.history();
            } else if (
                pathname === "/api/control/message-debug/clear" &&
                request.method === "POST"
            ) {
                const input = await readBody(request, 4096);
                if (!authorized()) {
                    jsonResponse(response, 401, { message: "控制认证失败" });
                    return true;
                }
                if (this.closed) throw new Error("消息调试服务已关闭");
                body = await this.service.clear(input);
            } else {
                status = 404;
                body = { message: "消息调试接口不存在" };
            }
        } catch (error) {
            status =
                typeof error === "object" &&
                error !== null &&
                "httpStatus" in error &&
                typeof error.httpStatus === "number" &&
                [400, 409, 423, 429, 503].includes(error.httpStatus)
                    ? error.httpStatus
                    : 503;
            body = { message: "消息调试请求未确认，请刷新状态；勿自动重试清空" };
        }
        if (!authorized()) jsonResponse(response, 401, { message: "控制认证失败" });
        else if (this.closed) jsonResponse(response, 503, { message: "消息调试服务已关闭" });
        else jsonResponse(response, status, body);
        return true;
    }

    private stream(
        request: IncomingMessage,
        response: ServerResponse,
        authorized: () => boolean,
    ): void {
        let stopped = false;
        let busy = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            clearInterval(timer);
            this.streams.delete(stop);
            request.off("aborted", stop);
            response.off("close", stop);
            response.off("error", stop);
            response.destroy();
        };
        const poll = async () => {
            if (stopped) return;
            if (!authorized() || this.closed || response.destroyed) return stop();
            if (busy) return;
            busy = true;
            try {
                const snapshot = await this.service!.history();
                if (stopped) return;
                if (!authorized() || this.closed) return stop();
                // 每次发送完整实例快照，重启后的序号不能与旧实例混合。
                if (!response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`))
                    stop();
            } catch {
                stop(); // 停止、切换或传输异常关闭流，不泄露底层错误，也不重放命令。
            } finally {
                busy = false;
            }
        };
        const timer = setInterval(() => void poll(), 1000);
        timer.unref();
        this.streams.add(stop);
        request.once("aborted", stop);
        response.once("close", stop);
        response.once("error", stop);
        try {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            });
            void poll();
        } catch {
            stop(); // 已断开的响应不可继续写入。
        }
    }
}
