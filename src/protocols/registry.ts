import { Protocol } from "./base";
import { Dict } from "@zhinjs/shared";

/**
 * Protocol Registry
 * Manages registration and retrieval of protocol implementations
 */
export class ProtocolRegistry {
    private static protocols: Map<string, Map<string, Protocol.Factory>> = new Map();
    private static metadata: Map<string, Protocol.Metadata> = new Map();

    /**
     * Register a protocol implementation
     * @param name Protocol name (e.g., 'onebot', 'milky', 'satori')
     * @param version Protocol version (e.g., 'v11', 'v12')
     * @param factory Protocol factory function
     * @param metadata Optional protocol metadata
     */
    static register(
        name: string,
        version: string,
        factory: Protocol.Factory,
        metadata?: Partial<Protocol.Metadata>,
    ): void {
        if (!this.protocols.has(name)) {
            this.protocols.set(name, new Map());
        }

        const versions = this.protocols.get(name)!;
        versions.set(version, factory);

        // Store or update metadata
        if (!this.metadata.has(name)) {
            this.metadata.set(name, {
                name,
                displayName: metadata?.displayName || name,
                description: metadata?.description || "",
                versions: [version],
            });
        } else {
            const meta = this.metadata.get(name)!;
            if (!meta.versions.includes(version)) {
                meta.versions.push(version);
            }
        }
    }

    /**
     * Get a protocol factory
     * @param name Protocol name
     * @param version Protocol version
     */
    static get(name: string, version: string): Protocol.Factory | undefined {
        return this.protocols.get(name)?.get(version);
    }

    /**
     * Check if a protocol version is registered
     */
    static has(name: string, version?: string): boolean {
        if (!version) {
            return this.protocols.has(name);
        }
        return this.protocols.get(name)?.has(version) || false;
    }

    /**
     * Get all registered protocol names
     */
    static getProtocolNames(): string[] {
        return Array.from(this.protocols.keys());
    }

    /**
     * Get all versions for a protocol
     */
    static getVersions(name: string): string[] {
        const versions = this.protocols.get(name);
        return versions ? Array.from(versions.keys()) : [];
    }

    /**
     * Get protocol metadata
     */
    static getMetadata(name: string): Protocol.Metadata | undefined {
        return this.metadata.get(name);
    }

    /**
     * Get all protocol metadata
     */
    static getAllMetadata(): Protocol.Metadata[] {
        return Array.from(this.metadata.values());
    }

    /**
     * Create a protocol instance
     */
    static create(name: string, version: string, adapter: any, oneBot: any, config: any): Protocol {
        const factory = this.get(name, version);
        if (!factory) {
            throw new Error(`Protocol ${name}/${version} not registered`);
        }
        return new factory(adapter, oneBot, config);
    }

    /**
     * Unregister a protocol version
     */
    static unregister(name: string, version?: string): boolean {
        if (!version) {
            // Unregister all versions
            this.protocols.delete(name);
            this.metadata.delete(name);
            return true;
        }

        const versions = this.protocols.get(name);
        if (!versions) return false;

        const result = versions.delete(version);

        // Update metadata
        const meta = this.metadata.get(name);
        if (meta) {
            meta.versions = meta.versions.filter(v => v !== version);
            if (meta.versions.length === 0) {
                this.metadata.delete(name);
                this.protocols.delete(name);
            }
        }

        return result;
    }

    /**
     * Clear all registered protocols
     */
    static clear(): void {
        this.protocols.clear();
        this.metadata.clear();
    }
}
