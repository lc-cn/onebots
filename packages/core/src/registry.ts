import { Protocol } from "./protocol.js";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";
import { Account } from "./account.js";
import type { Schema } from "./config-validator.js";

/**
 * Protocol Registry
 * Manages registration and retrieval of protocol implementations
 */
export class ProtocolRegistry {
    private static protocols: Map<string, Map<string, Protocol.Factory>> = new Map();
    private static metadata: Map<string, Protocol.Metadata> = new Map();
    private static schemas: Map<string, Schema> = new Map();

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
     * Register a protocol config schema (key format: name.version)
     */
    static registerSchema(key: string, schema: Schema): void {
        this.schemas.set(key, schema);
    }

    /**
     * Get a protocol config schema by key
     */
    static getSchema(key: string): Schema | undefined {
        return this.schemas.get(key);
    }

    /**
     * Get all protocol config schemas
     */
    static getAllSchemas(): Record<string, Schema> {
        return Object.fromEntries(this.schemas.entries());
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
    static create(name: string, version: string, adapter: Adapter, account: Account, config: any): Protocol {
        const factory = this.get(name, version);
        if (!factory) {
            throw new Error(`Protocol ${name}/${version} not registered`);
        }
        if(Protocol.isClassFactory(factory)){
            return new factory(adapter, account, config);
        }
        return factory(adapter, account, config);
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
        this.schemas.clear();
    }
}
/**
 * Adapter Registry
 * Manages registration and retrieval of adapter implementations
 */
export class AdapterRegistry {
    private static adapters: Map<string, Adapter.Factory> = new Map();
    private static metadata: Map<string, Adapter.Metadata> = new Map();
    private static schemas: Map<string, Schema> = new Map();

    /**
     * Register an adapter implementation
     * @param name Adapter name/platform (e.g., 'wechat', 'dingtalk', 'qq')
     * @param factory Adapter factory/class
     * @param metadata Optional adapter metadata
     */
    static register(
        name: string,
        factory: Adapter.Factory,
        metadata?: Partial<Adapter.Metadata>,
    ): void {
        this.adapters.set(name, factory);
        // Store or update metadata
        if (!this.metadata.has(name)) {
            this.metadata.set(name, {
                name,
                displayName: metadata?.displayName || name,
                description: metadata?.description || "",
                icon: metadata?.icon || "",
                homepage: metadata?.homepage,
                author: metadata?.author,
            });
        }
    }

    /**
     * Register an adapter config schema
     */
    static registerSchema(name: string, schema: Schema): void {
        this.schemas.set(name, schema);
    }

    /**
     * Get an adapter config schema
     */
    static getSchema(name: string): Schema | undefined {
        return this.schemas.get(name);
    }

    /**
     * Get all adapter config schemas
     */
    static getAllSchemas(): Record<string, Schema> {
        return Object.fromEntries(this.schemas.entries());
    }

    /**
     * Get an adapter factory
     * @param name Adapter name/platform
     */
    static get(name: string): Adapter.Factory | undefined {
        return this.adapters.get(name);
    }

    /**
     * Check if an adapter is registered
     */
    static has(name: string): boolean {
        return this.adapters.has(name);
    }

    /**
     * Get all registered adapter names
     */
    static getAdapterNames(): string[] {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get adapter metadata
     */
    static getMetadata(name: string): Adapter.Metadata | undefined {
        return this.metadata.get(name);
    }

    /**
     * Get all adapter metadata
     */
    static getAllMetadata(): Adapter.Metadata[] {
        return Array.from(this.metadata.values());
    }

    /**
     * Create an adapter instance
     */
    static create<T extends BaseApp>(name: string, app: T): Adapter<any,keyof Adapter.Configs,T> {
        const factory = this.get(name) as Adapter.Factory<Adapter<any,keyof Adapter.Configs,T>>;
        if (!factory) {
            throw new Error(`Adapter ${name} not registered`);
        }
        if(Adapter.isClassAdapter(factory)){
            return new factory(app);
        }
        return factory(app);
    }

    /**
     * Unregister an adapter
     */
    static unregister(name: string): boolean {
        this.metadata.delete(name);
        return this.adapters.delete(name);
    }

    /**
     * Clear all registered adapters
     */
    static clear(): void {
        this.adapters.clear();
        this.metadata.clear();
        this.schemas.clear();
    }
}
