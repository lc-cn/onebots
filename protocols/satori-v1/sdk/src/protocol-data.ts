import { ProtocolError, type Friend } from "imhelper";
import type {
    SatoriFriend,
    SatoriGuildRole,
    SatoriList,
    SatoriUser,
    SatoriV1Event,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function malformed(operation: string, response: unknown): never {
    throw new ProtocolError({
        protocol: "satori-v1",
        operation,
        kind: "protocol",
        message: `Satori ${operation} 返回了无效的数据结构`,
        response,
    });
}

/** 完整读取 Satori List<T>，同时拒绝非法数据和循环游标。 */
export async function collectList(
    operation: string,
    load: (next?: string) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    const visited = new Set<string>();
    let next: string | undefined;
    do {
        const response = await load(next);
        if (!isRecord(response) || !Array.isArray(response.data)) {
            return malformed(operation, response);
        }
        for (const item of response.data) {
            if (!isRecord(item)) return malformed(operation, response);
            result.push(item);
        }
        if (response.next !== undefined && typeof response.next !== "string") {
            return malformed(operation, response);
        }
        next = response.next as string | undefined;
        if (next && visited.has(next)) {
            return malformed(operation, response);
        }
        if (next) visited.add(next);
    } while (next);
    return result;
}

function optionalString(value: unknown, operation: string, response: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return malformed(operation, response);
    return value;
}

/** 解析官方 User。展示名在投影时优先 nick。 */
export function parseSatoriUser(value: unknown, operation: string): SatoriUser {
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
        return malformed(operation, value);
    }
    const name = optionalString(value.name, operation, value);
    const nick = optionalString(value.nick, operation, value);
    const avatar = optionalString(value.avatar, operation, value);
    if (value.is_bot !== undefined && typeof value.is_bot !== "boolean") {
        return malformed(operation, value);
    }
    return {
        id: value.id,
        ...(name !== undefined ? { name } : {}),
        ...(nick !== undefined ? { nick } : {}),
        ...(avatar !== undefined ? { avatar } : {}),
        ...(typeof value.is_bot === "boolean" ? { is_bot: value.is_bot } : {}),
    };
}

/**
 * 解析 Friend。
 * 文档形状是 `{ user?, nick? }`。1.0.10 之前的列表项是扁平 User，这里继续接受，避免旧服务端直接失败。
 */
export function parseSatoriFriend(value: unknown, operation: string): SatoriFriend {
    if (!isRecord(value)) return malformed(operation, value);
    const legacyUser = value.user === undefined && typeof value.id === "string";
    if (legacyUser) {
        const name = typeof value.name === "string" ? value.name : undefined;
        const username = typeof value.username === "string" ? value.username : undefined;
        const nick = typeof value.nick === "string" ? value.nick : undefined;
        const avatar = typeof value.avatar === "string" ? value.avatar : undefined;
        const displayName = name ?? username;
        return {
            user: parseSatoriUser(
                {
                    id: value.id,
                    ...(displayName !== undefined ? { name: displayName } : {}),
                    ...(nick !== undefined ? { nick } : {}),
                    ...(avatar !== undefined ? { avatar } : {}),
                    ...(typeof value.is_bot === "boolean" ? { is_bot: value.is_bot } : {}),
                },
                operation,
            ),
        };
    }
    if (value.user !== undefined && !isRecord(value.user)) return malformed(operation, value);
    const nick = optionalString(value.nick, operation, value);
    if (value.user === undefined && nick === undefined) return malformed(operation, value);
    const user = value.user === undefined ? undefined : parseSatoriUser(value.user, operation);
    return {
        ...(user ? { user } : {}),
        ...(nick !== undefined ? { nick } : {}),
    };
}

/** 将 Friend 投影为 imhelper 好友目录。没有 user.id 时拒绝伪造 ID。 */
export function friendToDirectory(friend: SatoriFriend, operation: string): Friend.Data<string> {
    if (!friend.user?.id) return malformed(operation, friend);
    return {
        user_id: friend.user.id,
        user_name: friend.user.nick || friend.user.name || "",
        avatar: friend.user.avatar ?? "",
        ...(friend.nick ? { remark: friend.nick } : {}),
    };
}

/**
 * GuildMember.roles 的协议类型是 GuildRole[]。
 * 仅含角色 ID 的旧 string[] 会规范成 `{ id }`，未知形状则拒绝。
 */
export function parseGuildRoles(value: unknown, operation: string): SatoriGuildRole[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return malformed(operation, value);
    return value.map(item => {
        if (typeof item === "string") {
            if (item.length === 0) return malformed(operation, value);
            return { id: item };
        }
        if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) {
            return malformed(operation, value);
        }
        const name = optionalString(item.name, operation, value);
        return {
            id: item.id,
            ...(name !== undefined ? { name } : {}),
        };
    });
}

/** 入站事件里的旧 string[] 角色规范成 GuildRole；非法形状保留原值，不中断事件。 */
export function normalizeEventMember(event: SatoriV1Event): void {
    const member = event.member;
    if (!member || member.roles === undefined) return;
    let roles: SatoriGuildRole[] | undefined;
    try {
        roles = parseGuildRoles(member.roles, "event.member.roles");
    } catch {
        // 目录读取会拒绝非法 roles；入站事件继续投递其余字段。
        return;
    }
    if (!roles) return;
    event.member = { ...member, roles };
}

export function parseSatoriUserList(value: unknown, operation: string): SatoriList<SatoriUser> {
    if (!isRecord(value) || !Array.isArray(value.data)) return malformed(operation, value);
    if (value.next !== undefined && typeof value.next !== "string") {
        return malformed(operation, value);
    }
    return {
        data: value.data.map(item => parseSatoriUser(item, operation)),
        ...(typeof value.next === "string" ? { next: value.next } : {}),
    };
}
