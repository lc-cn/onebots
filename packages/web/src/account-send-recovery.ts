export interface AccountSendOperationStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const storageKey = "onebots.control.pending-sends.v1";
const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validConversationKey(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2200) return false;
    try {
        const parts: unknown = JSON.parse(value);
        return (
            Array.isArray(parts) &&
            (parts.length === 4 || parts.length === 5) &&
            parts.every(part => typeof part === "string" && part.length <= 512) &&
            ["friend", "group", "channel"].includes(parts[1]) &&
            parts[0].includes("/") &&
            parts[3].length > 0 &&
            (parts.length === 4 ||
                (parts[1] === "friend" && parts[2] === "" && parts[4] === "direct"))
        );
    } catch {
        return false;
    }
}

/** 只恢复非秘密的操作定位信息；畸形或过大的浏览器状态直接忽略。 */
export function readPendingAccountSends(
    storage: AccountSendOperationStorage | undefined,
): Map<string, string> {
    if (!storage) return new Map();
    try {
        const raw = storage.getItem(storageKey);
        if (!raw || raw.length > 230_000) return new Map();
        const rows: unknown = JSON.parse(raw);
        if (!Array.isArray(rows) || rows.length > 100) return new Map();
        const result = new Map<string, string>();
        for (const row of rows) {
            if (!Array.isArray(row) || row.length !== 2) return new Map();
            const [key, id] = row as unknown[];
            if (!validConversationKey(key) || typeof id !== "string" || !operationId.test(id))
                return new Map();
            result.set(key, id);
        }
        return result;
    } catch {
        return new Map();
    }
}

export function writePendingAccountSends(
    storage: AccountSendOperationStorage | undefined,
    operations: ReadonlyMap<string, string>,
): void {
    if (!storage) return;
    try {
        storage.setItem(storageKey, JSON.stringify([...operations].slice(-100)));
    } catch {
        // 浏览器存储不可用不应影响已发出的消息与当前页查询。
    }
}

export function browserAccountSendStorage(): AccountSendOperationStorage | undefined {
    try {
        return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {
        return undefined;
    }
}
