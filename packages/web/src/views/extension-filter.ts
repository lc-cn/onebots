export type ExtensionFilter = "all" | "adapter" | "protocol";

export function parseExtensionFilter(value: unknown): ExtensionFilter {
    return value === "adapter" || value === "protocol" ? value : "all";
}
