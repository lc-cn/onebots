import type { ControlAdapterCatalogEntry } from "@onebots/core/control";

export type AdapterCatalogGroupKey = "local" | "platform" | "private";
export type AdapterCatalogFilter = "all" | "installed" | "not-installed";

export interface AdapterCatalogGroup {
    key: AdapterCatalogGroupKey;
    label: string;
    description: string;
    entries: ControlAdapterCatalogEntry[];
}

export interface AdapterCatalogPreview extends AdapterCatalogGroup {
    hiddenCount: number;
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

// 新用户先看到常见接入平台；目录仍完整可搜索，已装和已选项优先于推荐。
const DISCOVERY_ORDER = new Map(
    ["qq", "wechat", "wecom", "dingtalk", "feishu", "telegram"].map((name, index) => [name, index]),
);

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

/** 只筛选目录展示，不改动完整安装选择。 */
export function filterAdapterCatalog(
    entries: readonly ControlAdapterCatalogEntry[],
    installedNames: readonly string[],
    filter: AdapterCatalogFilter,
): ControlAdapterCatalogEntry[] {
    if (filter === "all") return [...entries];
    const installed = new Set(installedNames);
    return entries.filter(entry => installed.has(entry.name) === (filter === "installed"));
}

export function selectedAdapterEntries(
    entries: readonly ControlAdapterCatalogEntry[],
    selectedNames: readonly string[],
): ControlAdapterCatalogEntry[] {
    const selected = new Set(selectedNames);
    return entries.filter(entry => selected.has(entry.name));
}

/** 默认只展示少量候选；已安装和已选平台始终可见，避免折叠后失去操作上下文。 */
export function previewAdapterCatalogGroups(
    groups: readonly AdapterCatalogGroup[],
    selectedNames: readonly string[],
    installedNames: readonly string[],
    expandedKeys: ReadonlySet<AdapterCatalogGroupKey>,
    previewSize = 6,
): AdapterCatalogPreview[] {
    const pinned = new Set([...selectedNames, ...installedNames]);
    return groups.map(group => {
        const ordered = [...group.entries].sort((left, right) => {
            const leftRank = pinned.has(left.name) ? -1 : (DISCOVERY_ORDER.get(left.name) ?? 99);
            const rightRank = pinned.has(right.name) ? -1 : (DISCOVERY_ORDER.get(right.name) ?? 99);
            return leftRank - rightRank;
        });
        const entries = expandedKeys.has(group.key)
            ? ordered
            : ordered.filter((entry, index) => index < previewSize || pinned.has(entry.name));
        return { ...group, entries, hiddenCount: group.entries.length - entries.length };
    });
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
