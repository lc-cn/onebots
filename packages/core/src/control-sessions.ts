import type { ControlTransport } from "./control.js";

/** 浏览器授权标识与期限，不暴露会话凭据或其摘要。 */
export interface ControlSession {
    id: string;
    issuedAt: number;
    expiresAt: number;
    current: boolean;
}

export async function revokeControlSession(
    transport: ControlTransport,
    id: string,
): Promise<{ revoked: true }> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("设备会话标识无效");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result: unknown = await Promise.race([
            transport.request("POST", "/api/control/auth/sessions/revoke", { id }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("会话撤销结果未确认")), 15_000);
            }),
        ]);
        if (!result || typeof result !== "object" || Array.isArray(result) ||
            Object.keys(result).length !== 1 || !("revoked" in result) || result.revoked !== true)
            throw new Error("会话撤销结果未确认");
        return { revoked: true };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

export async function listControlSessions(transport: ControlTransport): Promise<{ sessions: ControlSession[] }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result: unknown = await Promise.race([
            transport.request("GET", "/api/control/auth/sessions"),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("设备会话读取超时")), 15_000);
            }),
        ]);
        if (!result || typeof result !== "object" || Array.isArray(result) ||
            Object.keys(result).length !== 1 || !("sessions" in result) ||
            !Array.isArray(result.sessions) || result.sessions.length > 16 ||
            !result.sessions.every(isSession) ||
            new Set(result.sessions.map(session => session.id)).size !== result.sessions.length ||
            result.sessions.filter(session => session.current).length !== 1)
            throw new Error("设备会话响应无效");
        return { sessions: result.sessions };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function isSession(value: unknown): value is ControlSession {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const session = value as Record<string, unknown>;
    return Object.keys(session).sort().join(",") === "current,expiresAt,id,issuedAt" &&
        typeof session.id === "string" && /^[a-f0-9]{32}$/.test(session.id) &&
        typeof session.current === "boolean" && typeof session.issuedAt === "number" &&
        Number.isSafeInteger(session.issuedAt) && session.issuedAt >= 0 &&
        typeof session.expiresAt === "number" && Number.isSafeInteger(session.expiresAt) &&
        session.expiresAt - session.issuedAt === 30 * 24 * 60 * 60 * 1000;
}
