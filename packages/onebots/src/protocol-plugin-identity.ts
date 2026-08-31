export interface ProtocolPluginIdentity {
    protocol: string;
    version: string;
    schemaKey: string;
}

export function parseProtocolPluginIdentity(name: string): ProtocolPluginIdentity | null {
    const match = /^(.+)-(v\d+)$/.exec(name);
    if (!match) return null;
    const protocol = match[1];
    const version = match[2];
    return { protocol, version, schemaKey: `${protocol}.${version}` };
}
