/**
 * OneBot protocol utilities
 * Provides reusable helper methods for OneBot protocols
 */
export namespace OneBotUtils {
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
    export function parseCompositeId(compositeId: string): {
        type: string;
        parts: string[];
        fullId: string;
    } {
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

    /**
     * Validate QQ number format
     */
    export function isValidQQ(qq: string | number): boolean {
        const qqStr = String(qq);
        return /^\d{5,11}$/.test(qqStr);
    }

    /**
     * Validate group number format
     */
    export function isValidGroup(group: string | number): boolean {
        const groupStr = String(group);
        return /^\d{6,10}$/.test(groupStr);
    }

    /**
     * Format timestamp to OneBot time format (seconds)
     */
    export function formatTime(timestamp: number): number {
        // If timestamp is in milliseconds, convert to seconds
        if (timestamp > 9999999999) {
            return Math.floor(timestamp / 1000);
        }
        return timestamp;
    }

    /**
     * Parse OneBot time to milliseconds
     */
    export function parseTime(time: number): number {
        // OneBot times are in seconds, convert to milliseconds
        if (time < 9999999999) {
            return time * 1000;
        }
        return time;
    }
}
