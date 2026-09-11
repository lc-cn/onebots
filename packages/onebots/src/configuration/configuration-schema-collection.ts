import type { ControlExtensionSelection } from "@onebots/core/control";
export function collectRuntimeSchemas(
    core: typeof import("@onebots/core"),
    selection: ControlExtensionSelection,
): string {
    const adapters: Record<string, unknown> = {};
    const protocols: Record<string, unknown> = {};
    const protocolMetadata: Array<{ registrationName: string; name: string; version: string }> = [];
    const applications: Record<string, unknown> = {};
    for (const name of selection.adapters) {
        if (!core.AdapterRegistry.has(name)) throw new Error("adapter");
        const schema = core.AdapterRegistry.getSchema(name);
        if (!schema) throw new Error("schema");
        adapters[name] = schema;
    }
    for (const name of selection.protocols) {
        // 从实际注册表反查，不通过拆包名虚构协议名和版本。
        const matches = core.ProtocolRegistry.getProtocolNames().flatMap((protocol: string) =>
            core.ProtocolRegistry.getVersions(protocol)
                .filter((version: string) => `${protocol}-${version}` === name)
                .map((version: string) => ({ registrationName: name, name: protocol, version })),
        );
        if (matches.length !== 1) throw new Error("protocol metadata");
        const metadata = matches[0];
        if (!core.ProtocolRegistry.has(metadata.name, metadata.version))
            throw new Error("protocol");
        const schema = core.ProtocolRegistry.getSchema(`${metadata.name}.${metadata.version}`);
        if (!schema) throw new Error("schema");
        protocols[name] = schema;
        protocolMetadata.push(metadata);
    }
    for (const name of selection.applications) {
        if (!core.ApplicationRegistry.has(name)) throw new Error("application");
        const application = core.ApplicationRegistry.get(name);
        applications[name] = { name, displayName: application.displayName };
    }
    const runtimeOnly: string[] = [];
    const converted = serialize({ adapters, protocols, applications }, "$", runtimeOnly, new Set());
    const schemas = JSON.stringify({
        schemaVersion: 1,
        ...(converted as object),
        protocolMetadata,
        runtimeOnly,
    });
    if (Buffer.byteLength(schemas) > 1024 * 1024) throw new Error("schema size");
    return schemas;
}

function serialize(
    value: unknown,
    location: string,
    runtimeOnly: string[],
    ancestors: Set<object>,
): unknown {
    if (typeof value === "function" || value === undefined) {
        runtimeOnly.push(location);
        return undefined;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof RegExp) return { source: value.source, flags: value.flags };
    if (!value || typeof value !== "object" || ancestors.has(value) || ancestors.size > 50)
        throw new Error("schema serialization");
    ancestors.add(value);
    try {
        if (Array.isArray(value))
            return Array.from({ length: value.length }, (_, index) => {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                return serialize(
                    descriptor && "value" in descriptor ? descriptor.value : undefined,
                    `${location}[${index}]`,
                    runtimeOnly,
                    ancestors,
                );
            });
        if (
            Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null
        )
            throw new Error("schema object");
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            const converted = serialize(
                descriptor && "value" in descriptor ? descriptor.value : undefined,
                `${location}.${key}`,
                runtimeOnly,
                ancestors,
            );
            if (converted !== undefined)
                Object.defineProperty(result, key, { value: converted, enumerable: true });
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}
