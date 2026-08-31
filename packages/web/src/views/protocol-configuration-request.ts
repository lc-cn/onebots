export function parseProtocolConfigurationRequest(
    value: unknown,
    availableProtocols: readonly string[],
): string | null {
    return typeof value === "string" && availableProtocols.includes(value) ? value : null;
}
