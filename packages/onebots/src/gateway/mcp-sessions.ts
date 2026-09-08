import type { BaseApp } from "@onebots/core";
import {
    isGatewayMcpRequest,
    MCP_ERRORS,
    MCP_FRAME_LIMIT,
    mcpFrameFits,
    type GatewayMcpRequest,
    type GatewayMcpResult,
} from "./mcp-contracts.js";
interface McpProtocol {
    handleStdioMessage(message: string): Promise<string | null>;
    on(event: string, callback: (message: string) => void): unknown;
    off(event: string, callback: (message: string) => void): unknown;
}
interface Session {
    protocol: McpProtocol;
    listener: (message: string) => void;
    touched: number;
    initialized: boolean;
    handshake: boolean;
    busy: boolean;
    events: string[];
    bytes: number;
    overflow: boolean;
}
export class GatewayMcpSessions {
    private readonly sessions = new Map<string, Session>();
    private readonly timer: NodeJS.Timeout;
    private closed = false;
    private activeExchanges = 0;
    constructor(
        private readonly app: Pick<BaseApp, "adapters">,
        private readonly now = Date.now,
    ) {
        this.timer = setInterval(() => this.expire(), 1000);
        this.timer.unref();
    }
    async request(request: GatewayMcpRequest): Promise<GatewayMcpResult> {
        if (!isGatewayMcpRequest(request)) throw new Error(MCP_ERRORS[0]);
        if (this.closed) throw new Error(MCP_ERRORS[1]);
        this.expire();
        const { action, sessionId } = request;
        if (action === "close") {
            this.remove(sessionId);
            return {};
        }
        if (action === "open") {
            if (this.sessions.has(sessionId)) throw new Error(MCP_ERRORS[4]);
            if (this.sessions.size >= 8) throw new Error(MCP_ERRORS[6]);
            const choices: McpProtocol[] = [];
            const slash = request.account?.indexOf("/") ?? -1;
            for (const [platform, adapter] of this.app.adapters)
                for (const [id, account] of adapter.accounts) {
                    if (
                        request.account &&
                        (String(platform) !== request.account.slice(0, slash) ||
                            id !== request.account.slice(slash + 1))
                    )
                        continue;
                    for (const protocol of account.protocols) {
                        if (protocol.name !== "mcp" || protocol.version !== "v1") continue;
                        if (
                            typeof (protocol as unknown as McpProtocol).handleStdioMessage ===
                            "function"
                        )
                            choices.push(protocol as unknown as McpProtocol);
                    }
                }
            if (choices.length !== 1)
                throw new Error(choices.length > 1 ? MCP_ERRORS[2] : MCP_ERRORS[3]);
            const session: Session = {
                protocol: choices[0],
                listener: () => {},
                touched: this.now(),
                initialized: false,
                handshake: false,
                busy: false,
                events: [],
                bytes: 0,
                overflow: false,
            };
            session.listener = message => {
                if (!session.initialized || !this.sessions.has(sessionId)) return;
                const size = typeof message === "string" ? Buffer.byteLength(message) : Infinity;
                if (
                    session.events.length >= 64 ||
                    session.bytes + size > 256 * 1024 ||
                    size > MCP_FRAME_LIMIT - 1024 ||
                    !mcpFrameFits({ events: [message], padding: " ".repeat(1024) })
                ) {
                    session.overflow = true;
                    return;
                }
                session.events.push(message);
                session.bytes += size;
            };
            this.sessions.set(sessionId, session);
            session.protocol.on("mcp.notification", session.listener);
            return {};
        }
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(MCP_ERRORS[4]);
        session.touched = this.now();
        if (session.overflow) {
            this.remove(sessionId);
            throw new Error(MCP_ERRORS[8]);
        }
        if (action === "poll") {
            const events: string[] = [];
            while (
                session.events.length &&
                events.length < 32 &&
                mcpFrameFits({ events: [...events, session.events[0]], padding: " ".repeat(1024) })
            ) {
                const event = session.events.shift()!;
                session.bytes -= Buffer.byteLength(event);
                events.push(event);
            }
            return { events };
        }
        if (session.busy || this.activeExchanges >= 8) throw new Error(MCP_ERRORS[5]);
        session.busy = true;
        this.activeExchanges++;
        try {
            try {
                const input = JSON.parse(request.message!);
                if (input?.jsonrpc === "2.0" && input.method === "initialize") {
                    session.handshake = false;
                    session.initialized = false;
                }
            } catch {
                /* 协议处理器负责返回 JSON 解析错误。 */
            }

            const message = await session.protocol.handleStdioMessage(request.message!);
            if (this.sessions.get(sessionId) !== session) throw new Error();
            if (message !== null && typeof message !== "string") throw new Error();
            if (!mcpFrameFits({ message, padding: " ".repeat(1024) })) throw new Error();
            try {
                const input = JSON.parse(request.message!);
                if (input?.jsonrpc === "2.0" && input.method === "initialize" && message !== null) {
                    const response = JSON.parse(message);
                    session.handshake =
                        input.id !== undefined &&
                        input.id !== null &&
                        response?.jsonrpc === "2.0" &&
                        response.id === input.id &&
                        !Object.hasOwn(response, "error") &&
                        Object.hasOwn(response, "result");
                }
                if (
                    session.handshake &&
                    input?.jsonrpc === "2.0" &&
                    ["initialized", "notifications/initialized"].includes(input.method) &&
                    !Object.hasOwn(input, "id") &&
                    message === null
                )
                    session.initialized = true;
            } catch {
                /* Invalid JSON-RPC response remains protocol-owned, never enables notifications. */
            }
            return { message };
        } catch {
            throw new Error(MCP_ERRORS[7]);
        } finally {
            // 会话关闭不代表工具已取消；只在实际调用settle后归还容量。
            this.activeExchanges--;
            session.busy = false;
            session.touched = this.now();
        }
    }
    close(): void {
        this.closed = true;
        clearInterval(this.timer);
        for (const id of this.sessions.keys()) this.remove(id);
    }
    private remove(id: string) {
        const session = this.sessions.get(id);
        if (session) {
            this.sessions.delete(id);
            session.protocol.off("mcp.notification", session.listener);
        }
    }
    private expire() {
        for (const [id, session] of this.sessions)
            if (this.now() - session.touched >= 60_000) this.remove(id);
    }
}
