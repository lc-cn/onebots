import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";

/**
 * Common adapter utilities
 * Provides reusable helper methods for platform adapters
 */
export namespace AdapterUtils {
    /**
     * Transform message ID for V11 compatibility
     * In V11, message IDs need to be integers, so we use the transformToInt method
     */
    export function transformMessageId<V extends OneBot.Version>(
        oneBot: OneBot,
        version: V,
        messageId: string,
    ): string | number {
        if (version === "V11") {
            return oneBot.V11.transformToInt("message_id", messageId);
        }
        return messageId;
    }

    /**
     * Create a message result with proper ID format
     */
    export function createMessageResult<V extends OneBot.Version>(
        oneBot: OneBot,
        version: V,
        messageId: string,
    ): OneBot.MessageRet<V> {
        return {
            message_id: transformMessageId(oneBot, version, messageId),
        } as OneBot.MessageRet<V>;
    }

    /**
     * Create event handler disposer
     * Returns a cleanup function that removes all event listeners
     */
    export function createEventDisposer(disposers: Function[]): () => void {
        return () => {
            while (disposers.length > 0) {
                disposers.pop()?.();
            }
        };
    }

    /**
     * Register event handler with auto-disposal
     */
    export function registerEventHandler<T extends { on: Function; off: Function }>(
        emitter: T,
        event: string,
        handler: Function,
        disposers: Function[],
    ): void {
        emitter.on(event, handler);
        disposers.push(() => {
            emitter.off(event, handler);
        });
    }

    /**
     * Get package version from node_modules
     */
    export function getPackageVersion(packageName: string): string {
        try {
            const path = require("path");
            const pkgPath = path.resolve(
                path.dirname(require.resolve(packageName)),
                "../package.json",
            );
            const pkg = require(pkgPath);
            return pkg.version;
        } catch (e) {
            return "unknown";
        }
    }

    /**
     * Create dependency string with version
     */
    export function createDependencyString(packageName: string): string {
        const version = getPackageVersion(packageName);
        return `${packageName} v${version}`;
    }

    /**
     * Extract platform-specific ID from composite ID
     * E.g., "guild:123:456" => { type: "guild", id1: "123", id2: "456" }
     */
    export function parseCompositeId(
        compositeId: string,
    ): { type: string; parts: string[]; fullId: string } {
        const parts = compositeId.split(":");
        const type = parts[0];
        return {
            type,
            parts: parts.slice(1),
            fullId: compositeId,
        };
    }

    /**
     * Create composite ID
     * E.g., createCompositeId("guild", "123", "456") => "guild:123:456"
     */
    export function createCompositeId(type: string, ...parts: (string | number)[]): string {
        return [type, ...parts].join(":");
    }
}
