import { ProtocolError } from "imhelper";

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
