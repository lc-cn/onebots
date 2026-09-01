import type {
    AdapterCapabilityManifest,
    CapabilityAvailability,
    CapabilityDescriptor,
    CapabilityDirection,
    CapabilitySupport,
    CommonTypes,
    SegmentCapabilityDescriptor,
    TransportCapabilityDescriptor,
} from "@onebots/core";
import type { AdapterInfo, ExtensionInfo } from "../types";

const EMPTY_CAPABILITY_MANIFEST: AdapterCapabilityManifest = {
    version: 1,
    actions: {},
    events: {},
    segments: {},
    transports: {},
};

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

export function capabilitySupportLabel(support: CapabilitySupport): string {
    return { native: "原生", emulated: "模拟", unsupported: "不支持" }[support];
}

export function capabilityAvailabilityLabel(availability: CapabilityAvailability): string {
    return { always: "始终可用", permission: "需要权限", context: "依赖上下文" }[availability];
}

export function capabilityDirectionLabel(direction: CapabilityDirection): string {
    return { send: "发送", receive: "接收", both: "双向" }[direction];
}

export function capabilitySceneLabel(scene: CommonTypes.Scene): string {
    return {
        private: "私聊",
        group: "群聊",
        channel: "频道",
        direct: "直接会话",
    }[scene];
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
            !extension.capability
        ) {
            return [];
        }
        const verified = extension.capability.status === "verified";
        return [
            {
                platform: extension.name,
                displayName: extension.displayName,
                description: extension.description,
                icon: "",
                capabilities: extension.capability.manifest ?? EMPTY_CAPABILITY_MANIFEST,
                capabilityDeclared: extension.capability.declared,
                capabilitySource: extension.capability.source,
                capabilityPackageVersion: extension.capability.packageVersion,
                capabilityStatus: extension.capability.status,
                capabilityUnavailableReason: verified
                    ? undefined
                    : extension.catalogError || undefined,
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
                capabilityDeclared: adapter.capabilityDeclared ?? true,
                capabilitySource: "runtime" as const,
                capabilityStatus:
                    adapter.capabilityStatus ??
                    (adapter.capabilityDeclared === false ? "unknown" : "verified"),
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
