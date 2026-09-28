export interface ExtensionTab {
    key: string;
    label: string;
    installed: boolean;
    count: number;
}

/** 已安装依赖决定可添加的分类；目录外的旧配置仍可见，便于清理。 */
export function buildExtensionTabs(
    installedNames: string[],
    entries: Array<{ name: string; displayName: string }>,
    observedKeys: string[],
    keyForName: (name: string) => string = name => name,
): ExtensionTab[] {
    const labels = new Map(entries.map(entry => [entry.name, entry.displayName]));
    const counts = new Map<string, number>();
    for (const key of observedKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const tabs = new Map<string, ExtensionTab>();
    for (const name of installedNames) {
        const key = keyForName(name);
        tabs.set(key, {
            key,
            label: labels.get(name) ?? name,
            installed: true,
            count: counts.get(key) ?? 0,
        });
    }
    for (const key of observedKeys) {
        if (!tabs.has(key))
            tabs.set(key, { key, label: key, installed: false, count: counts.get(key) ?? 0 });
    }
    return [...tabs.values()];
}

/** 安装目录使用 npm 风格名，协议配置与事件使用 name.version 键。 */
export function protocolKeyForPackage(name: string): string {
    return name.replace(/-/g, ".");
}
