import type {
    AdapterCapabilityManifest,
    CapabilityDescriptor,
    SegmentCapabilityDescriptor,
    TransportCapabilityDescriptor,
} from "@onebots/core";

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
