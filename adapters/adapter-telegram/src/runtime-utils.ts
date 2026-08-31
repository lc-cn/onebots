import type { Update } from "grammy/types";

export function isTelegramUpdate(value: unknown): value is Update {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "update_id" in value &&
        typeof value.update_id === "number" &&
        Number.isSafeInteger(value.update_id)
    );
}

export function pollingRetryDelay(attempt: number): number {
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
    return Math.round(base * (0.75 + Math.random() * 0.5));
}

export function abortableDelay(delay: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

export function maskProxyAddress(value: string): string {
    try {
        const url = new URL(value);
        if (url.username) url.username = "***";
        if (url.password) url.password = "***";
        return url.toString();
    } catch {
        return "<invalid-proxy-url>";
    }
}

export function isSupportedProxyUrl(value: string): boolean {
    try {
        return ["http:", "https:", "socks4:", "socks5:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}
