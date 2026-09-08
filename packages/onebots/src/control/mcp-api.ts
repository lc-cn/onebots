import { randomUUID } from "node:crypto";
import {
    isGatewayMcpRequest,
    isGatewayMcpResult,
    type GatewayMcpRequest,
    type GatewayMcpResult,
} from "../gateway/mcp-contracts.js";
interface Session {
    owner: string;
    gateway: string;
    touched: number;
    opening: boolean;
    exchange: boolean;
    poll: boolean;
    cleanupSent: boolean;
    earlyCleanup: boolean;
    lateCleanupSent: boolean;
}
export interface McpApiOptions {
    currentGateway(): string | undefined;
    forward(instanceId: string, request: GatewayMcpRequest): Promise<GatewayMcpResult>;
    now?(): number;
}
export interface McpApiRequest {
    pathname: string;
    method: string;
    owner: string;
    body(): Promise<unknown>;
}
export interface McpApiResponse {
    status: number;
    body: unknown;
}
const error = (status: number): McpApiResponse => ({
    status,
    body: { message: "MCP 请求或会话不可用；未重放调用" },
});
function closed(
    value: unknown,
    required: string[],
    optional: string[] = [],
): value is Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        return false;
    return (
        required.every(key => Object.hasOwn(value, key)) &&
        Reflect.ownKeys(value).every(
            key =>
                typeof key === "string" &&
                [...required, ...optional].includes(key) &&
                Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
                "value" in Object.getOwnPropertyDescriptor(value, key)!,
        )
    );
}
/** 进程内管理会话仅绑定可信 owner 与当前网关；无持久化、无重放，网关自身同时执行有界过期。 */
export class ControlMcpService {
    private readonly sessions = new Map<string, Session>();
    private readonly now: () => number;
    constructor(private readonly options: McpApiOptions) {
        this.now = options.now ?? Date.now;
    }
    revokeOwner(owner: string): void {
        for (const [id, session] of this.sessions)
            if (session.owner === owner) {
                this.sessions.delete(id);
                this.cleanup(id, session);
            }
    }
    private expire() {
        const current = this.options.currentGateway();
        for (const [id, session] of this.sessions)
            if (session.gateway !== current || this.now() - session.touched >= 60_000) {
                this.sessions.delete(id);
                this.cleanup(id, session);
            }
    }
    private cleanup(id: string, session: Session, lateOpen = false): void {
        if (this.options.currentGateway() !== session.gateway) return;
        if (session.cleanupSent) {
            if (!lateOpen || !session.earlyCleanup || session.lateCleanupSent) return;
            session.lateCleanupSent = true;
        } else {
            session.cleanupSent = true;
            session.earlyCleanup = session.opening;
        }
        // 超时或撤销可能先于远端创建；仅迟到 open 成功时允许第二次收尾，不重试工具调用。
        void this.forward(session.gateway, { action: "close", sessionId: id }).catch(() => {
            /* 收尾失败交给网关TTL，不递归重试。 */
        });
    }
    private current(id: string, session: Session) {
        this.expire();
        return this.sessions.get(id) === session;
    }
    private async forward(
        instance: string,
        request: GatewayMcpRequest,
        session?: Session,
    ): Promise<GatewayMcpResult> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const operation = this.options.forward(instance, request);
        void operation.then(
            () => {
                if (timedOut && request.action === "open" && session) {
                    session.opening = false;
                    this.cleanup(request.sessionId, session, true);
                }
            },
            () => {},
        );
        try {
            return await Promise.race([
                operation,
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        reject(new Error("MCP timeout"));
                    }, 30_000);
                    timer.unref();
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    async handle(request: McpApiRequest): Promise<McpApiResponse | undefined> {
        const match = /^\/api\/control\/mcp\/(open|exchange|poll|close)$/.exec(request.pathname);
        if (!match) return undefined;
        if (request.method !== "POST") return error(405);
        if (typeof request.owner !== "string" || !request.owner || request.owner.length > 256)
            return error(400);
        const action = match[1] as GatewayMcpRequest["action"];
        let body: unknown;
        try {
            body = await request.body();
        } catch {
            return error(400);
        }
        if (
            !closed(
                body,
                action === "open" ? [] : action === "exchange" ? ["id", "message"] : ["id"],
                action === "open" ? ["account"] : [],
            )
        )
            return error(400);
        const id = action === "open" ? randomUUID() : body.id;
        const gatewayRequest = {
            action,
            sessionId: id,
            ...(Object.hasOwn(body, "account") ? { account: body.account } : {}),
            ...(Object.hasOwn(body, "message") ? { message: body.message } : {}),
        };
        if (!isGatewayMcpRequest(gatewayRequest)) return error(400);
        const sessionId = gatewayRequest.sessionId;
        this.expire();
        const gateway = this.options.currentGateway();
        if (!gateway) return error(503);
        let session: Session;
        if (action === "open") {
            if (this.sessions.size >= 8) return error(429);
            session = {
                owner: request.owner,
                gateway,
                touched: this.now(),
                opening: true,
                exchange: false,
                poll: false,
                cleanupSent: false,
                earlyCleanup: false,
                lateCleanupSent: false,
            };
            this.sessions.set(sessionId, session);
        } else {
            const existing = this.sessions.get(sessionId);
            if (!existing || existing.owner !== request.owner || existing.gateway !== gateway)
                return error(404);
            session = existing;
            if (action === "close") {
                this.sessions.delete(sessionId);
                session.cleanupSent = true;
                session.earlyCleanup = session.opening;
            } else {
                if (session.opening || (action === "exchange" ? session.exchange : session.poll))
                    return error(409);
                session[action] = true;
                session.touched = this.now();
            }
        }
        try {
            const result = await this.forward(gateway, gatewayRequest, session);
            if (action === "open") session.opening = false;
            const valid =
                isGatewayMcpResult(result) &&
                (action === "exchange"
                    ? closed(result, ["message"])
                    : action === "poll"
                      ? closed(result, ["events"])
                      : closed(result, []));
            if (!valid) throw new Error("invalid result");
            if (action === "close") return { status: 200, body: { closed: true } };
            if (!this.current(sessionId, session)) {
                if (action === "open") this.cleanup(sessionId, session, true);
                return error(503);
            }
            session.opening = false;
            session.touched = this.now();
            return {
                status: 200,
                body: action === "open" ? { id: sessionId, gatewayInstanceId: gateway } : result,
            };
        } catch {
            this.sessions.delete(sessionId);
            if (action !== "close") this.cleanup(sessionId, session);
            return error(503);
        } finally {
            if (action === "exchange" || action === "poll") session[action] = false;
        }
    }
}
