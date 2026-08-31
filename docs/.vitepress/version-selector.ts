/**
 * 版本选择器组件
 * 用于在导航栏显示版本选择下拉菜单
 */

export interface VersionInfo {
    version: string;
    label: string;
    link: string;
    isCurrent?: boolean;
}

// 版本列表配置
// 当有新版本发布时，在这里添加新版本，并将旧版本保留
export const versions: VersionInfo[] = [
    {
        version: '0.5.0',
        label: 'v0.5.0 (最新)',
        link: '/',
        isCurrent: true
    },
    // 示例：旧版本
    // {
    //     version: '0.4.0',
    //     label: 'v0.4.0',
    //     link: '/v0.4.0/',
    //     isCurrent: false
    // },
    // {
    //     version: '0.3.0',
    //     label: 'v0.3.0',
    //     link: '/v0.3.0/',
    //     isCurrent: false
    // }
];

/**
 * 获取当前版本
 */
export function getCurrentVersion(): VersionInfo | undefined {
    return versions.find(v => v.isCurrent);
}

/**
 * 根据路径获取版本
 */
export function getVersionFromPath(path: string): VersionInfo | undefined {
    // 如果路径以 /vX.X.X/ 开头，提取版本号
    const match = path.match(/^\/v(\d+\.\d+\.\d+)\//);
    if (match) {
        return versions.find(v => v.version === match[1]);
    }
    // 默认返回当前版本
    return getCurrentVersion();
}

/**
 * 获取所有版本（不包括当前版本）
 */
export function getOtherVersions(): VersionInfo[] {
    return versions.filter(v => !v.isCurrent);
}

