import type { MatrixHttpRequest } from "./types.js";

export function findHeader(
    headers: MatrixHttpRequest["headers"],
    name: string,
): string | undefined {
    if (!headers) return undefined;
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    return entry?.[1];
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const onAbort = (): void => {
            clearTimeout(timeout);
            reject(signal.reason);
        };
        const timeout = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function trimMap<TKey, TValue>(map: Map<TKey, TValue>, limit: number): void {
    while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) return;
        map.delete(oldest);
    }
}
