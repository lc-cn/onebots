import type {
    AdapterCapabilityManifest,
    CapabilityDescriptor,
    SegmentCapabilityDescriptor,
    TransportCapabilityDescriptor,
} from "@onebots/core";
import type { AdapterInfo, ExtensionInfo } from "../types";

export const CAPABILITY_CATEGORIES = [
    { key: "actions", label: "动作" },
    { key: "events", label: "事件" },
    { key: "segments", label: "消息段" },
    { key: "transports", label: "传输" },
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]["key"];
export type CapabilityEntryDescriptor =
    | CapabilityDescriptor
    | SegmentCapabilityDescriptor
    | TransportCapabilityDescriptor;

export interface CapabilityEntry {
    name: string;
    descriptor: CapabilityEntryDescriptor;
}

export function mergeCapabilityAdapters(
    runtimeAdapters: readonly AdapterInfo[],
    extensions: readonly ExtensionInfo[],
): AdapterInfo[] {
    const runtimePlatforms = new Set(runtimeAdapters.map(adapter => adapter.platform));
    const catalogAdapters = extensions.flatMap(extension => {
        if (
            extension.type !== "adapter" ||
            runtimePlatforms.has(extension.name) ||
            !extension.capability?.declared ||
            !extension.capability.manifest
        ) {
            return [];
        }
        return [
            {
                platform: extension.name,
                displayName: extension.displayName,
                description: extension.description,
                icon: "",
                capabilities: extension.capability.manifest,
                capabilitySource: extension.capability.source,
                capabilityPackageVersion: extension.capability.packageVersion,
                accounts: [],
            } satisfies AdapterInfo,
        ];
    });
    return [
        ...runtimeAdapters.map(adapter => {
            const runtimeCapability = extensions.find(
                extension => extension.type === "adapter" && extension.name === adapter.platform,
            )?.capability;
            return {
                ...adapter,
                capabilitySource: "runtime" as const,
                capabilityPackageVersion:
                    adapter.capabilityPackageVersion ?? runtimeCapability?.packageVersion,
            };
        }),
        ...catalogAdapters,
    ];
}

export function getCapabilityEntries(
    manifest: AdapterCapabilityManifest,
    category: CapabilityCategory,
): CapabilityEntry[] {
    return Object.entries(manifest[category])
        .map(([name, descriptor]) => ({ name, descriptor }))
        .sort((left, right) => {
            const supportOrder = { native: 0, emulated: 1, unsupported: 2 } as const;
            return (
                supportOrder[left.descriptor.support] - supportOrder[right.descriptor.support] ||
                left.name.localeCompare(right.name)
            );
        });
}

export function countSupportedCapabilities(
    manifest: AdapterCapabilityManifest,
    category: CapabilityCategory,
): number {
    return getCapabilityEntries(manifest, category).filter(
        entry => entry.descriptor.support !== "unsupported",
    ).length;
}

export function resolveAccountCapabilities(
    adapter: Pick<AdapterInfo, "accountCapabilities" | "capabilities">,
    accountId?: string,
): AdapterCapabilityManifest {
    return (accountId && adapter.accountCapabilities?.[accountId]) || adapter.capabilities;
}

export function hasAccountCapabilityOverride(
    adapter: Pick<AdapterInfo, "accountCapabilities">,
    accountId?: string,
): boolean {
    return Boolean(accountId && adapter.accountCapabilities?.[accountId]);
}

export function resolveAccountCapabilityError(
    adapter: Pick<AdapterInfo, "accountCapabilityErrors">,
    accountId?: string,
) {
    return accountId ? adapter.accountCapabilityErrors?.[accountId] : undefined;
}
