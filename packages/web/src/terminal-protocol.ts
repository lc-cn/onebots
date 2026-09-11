export interface TerminalStatus {
    available: boolean;
    localOnly: true;
    activeSessions: number;
}

export interface TerminalTicket {
    ticket: string;
    expiresAt: number;
}

export type TerminalServerMessage =
    | {
          type: "identity";
          application: "onebots";
          version: string;
          instanceId: string;
          cwd: string;
      }
    | { type: "ready" }
    | { type: "output"; data: string }
    | { type: "exit"; exitCode: number }
    | { type: "error"; code: string; message: string };

export function parseTerminalStatus(value: unknown): TerminalStatus {
    if (
        !record(value) ||
        typeof value.available !== "boolean" ||
        value.localOnly !== true ||
        !nonNegativeInteger(value.activeSessions)
    ) {
        throw new Error("终端状态响应无效");
    }
    return {
        available: value.available,
        localOnly: true,
        activeSessions: value.activeSessions,
    };
}

export function parseTerminalTicket(value: unknown): TerminalTicket {
    if (
        !record(value) ||
        typeof value.ticket !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(value.ticket) ||
        !Number.isSafeInteger(value.expiresAt) ||
        Number(value.expiresAt) <= Date.now()
    ) {
        throw new Error("终端连接票据无效或已过期");
    }
    return { ticket: value.ticket, expiresAt: Number(value.expiresAt) };
}

export function parseTerminalServerMessage(value: unknown): TerminalServerMessage {
    if (!record(value) || typeof value.type !== "string") throw new Error("终端消息格式无效");
    if (value.type === "identity") {
        if (
            value.application !== "onebots" ||
            !text(value.version) ||
            !text(value.instance_id) ||
            !text(value.cwd)
        ) {
            throw new Error("终端身份信息不完整");
        }
        return {
            type: "identity",
            application: "onebots",
            version: value.version,
            instanceId: value.instance_id,
            cwd: value.cwd,
        };
    }
    if (value.type === "ready") return { type: "ready" };
    if (value.type === "output" && typeof value.data === "string")
        return { type: "output", data: value.data };
    if (value.type === "exit" && Number.isSafeInteger(value.exitCode))
        return { type: "exit", exitCode: Number(value.exitCode) };
    if (value.type === "error" && text(value.code) && text(value.message))
        return { type: "error", code: value.code, message: value.message };
    throw new Error("终端消息包含未知内容");
}

export function terminalWebSocketUrl(
    ticket: string,
    location: Pick<Location, "protocol" | "host">,
) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${location.host}/api/control/terminal`);
    url.searchParams.set("ticket", ticket);
    return url.toString();
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function nonNegativeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
