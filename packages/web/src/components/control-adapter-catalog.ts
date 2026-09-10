import type { ControlAdapterCatalogEntry } from "@onebots/core/control";

export type AdapterCatalogGroupKey = "local" | "platform" | "private";

export interface AdapterCatalogGroup {
    key: AdapterCatalogGroupKey;
    label: string;
    description: string;
    entries: ControlAdapterCatalogEntry[];
}

const GROUPS: ReadonlyArray<Omit<AdapterCatalogGroup, "entries">> = [
    {
        key: "local",
        label: "本地验证",
        description: "无需外部平台账号，可先验证安装与协议连接。",
    },
    {
        key: "platform",
        label: "平台接入",
        description: "安装后需要在对应平台创建应用或机器人并填写凭据。",
    },
    {
        key: "private",
        label: "需下载授权",
        description: "安装依赖来自受限软件源，确认计划后才会临时请求授权。",
    },
];

export function groupAdapterCatalog(
    entries: readonly ControlAdapterCatalogEntry[],
    query: string,
): AdapterCatalogGroup[] {
    const normalized = query.trim().toLocaleLowerCase();
    const visible = normalized
        ? entries.filter(entry => searchableText(entry).includes(normalized))
        : [...entries];
    return GROUPS.map(group => ({
        ...group,
        entries: visible.filter(entry => groupFor(entry) === group.key),
    })).filter(group => group.entries.length > 0);
}

export function selectedAdapterEntries(
    entries: readonly ControlAdapterCatalogEntry[],
    selectedNames: readonly string[],
): ControlAdapterCatalogEntry[] {
    const selected = new Set(selectedNames);
    return entries.filter(entry => selected.has(entry.name));
}

function groupFor(entry: ControlAdapterCatalogEntry): AdapterCatalogGroupKey {
    if (entry.requirements?.some(requirement => requirement.kind === "registry-authentication"))
        return "private";
    if (entry.name === "mock") return "local";
    return "platform";
}

function searchableText(entry: ControlAdapterCatalogEntry): string {
    const manifest = entry.capabilitySnapshot?.manifest;
    return [
        entry.name,
        entry.displayName,
        entry.description ?? "",
        entry.packageName ?? "",
        ...(entry.setup ?? []).flatMap(step => [step.title, step.description]),
        ...(entry.requirements ?? []).flatMap(requirement => [
            requirement.title,
            requirement.description,
            requirement.scope,
            requirement.permission,
        ]),
        ...(entry.peerDependencies ?? []).flatMap(peer => [peer.packageName, peer.range]),
        ...Object.keys(manifest?.actions ?? {}),
        ...Object.keys(manifest?.events ?? {}),
        ...Object.keys(manifest?.segments ?? {}),
        ...Object.keys(manifest?.transports ?? {}),
    ]
        .join(" ")
        .toLocaleLowerCase();
}
