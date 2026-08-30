export type DiscordRuntime =
    | "node"
    | "cloudflare"
    | "vercel"
    | "deno"
    | "bun"
    | "browser"
    | "unknown";

/** 检测当前运行时，只用于选择默认传输；显式 mode 始终优先。 */
export function detectDiscordRuntime(): DiscordRuntime {
    if (
        typeof globalThis.caches !== "undefined" &&
        typeof (globalThis as Record<string, unknown>).WebSocketPair !== "undefined"
    ) {
        return "cloudflare";
    }
    if (typeof (globalThis as Record<string, unknown>).EdgeRuntime !== "undefined") return "vercel";
    if (typeof (globalThis as Record<string, unknown>).Deno !== "undefined") return "deno";
    if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") return "bun";
    if (typeof process !== "undefined" && process.versions?.node) return "node";
    if (typeof window !== "undefined" && typeof document !== "undefined") return "browser";
    return "unknown";
}

export function supportsDiscordGateway(): boolean {
    return ["node", "bun", "deno"].includes(detectDiscordRuntime());
}
