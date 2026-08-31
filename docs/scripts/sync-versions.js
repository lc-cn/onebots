#!/usr/bin/env node

/**
 * 同步 Git 标签到版本选择器配置
 * 自动从 Git 标签读取版本信息并更新 version-selector.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const versionSelectorPath = path.resolve(__dirname, '../.vitepress/version-selector.ts');

function getCurrentVersion() {
    const pkgPath = path.resolve(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
}

function getGitTags() {
    try {
        const tags = execSync('git tag -l "v*"', { cwd: rootDir, encoding: 'utf-8' })
            .trim()
            .split('\n')
            .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag))
            .map(tag => tag.substring(1)) // 移除 'v' 前缀
            .sort((a, b) => {
                // 版本号排序
                const aParts = a.split('.').map(Number);
                const bParts = b.split('.').map(Number);
                for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                    const aPart = aParts[i] || 0;
                    const bPart = bParts[i] || 0;
                    if (aPart !== bPart) {
                        return bPart - aPart; // 降序
                    }
                }
                return 0;
            });
        return tags;
    } catch (error) {
        console.error('❌ Failed to get git tags:', error.message);
        return [];
    }
}

function generateVersionSelector(versions, currentVersion) {
    const current = versions[0]; // 最新版本
    
    const versionInfos = versions.map((version, index) => {
        const isCurrent = version === currentVersion || (index === 0 && version === current);
        return {
            version,
            label: `v${version}${isCurrent ? ' (最新)' : ''}`,
            link: isCurrent ? '/' : `/v${version}/`,
            isCurrent
        };
    });

    // 生成 TypeScript 代码
    const versionsCode = versionInfos.map(v => 
        `    {\n        version: '${v.version}',\n        label: '${v.label}',\n        link: '${v.link}',\n        isCurrent: ${v.isCurrent}\n    }`
    ).join(',\n');

    return `/**
 * 版本选择器组件
 * 用于在导航栏显示版本选择下拉菜单
 * 
 * ⚠️ 此文件由 scripts/sync-versions.js 自动生成
 * 如需手动修改，请运行: pnpm docs:sync-versions
 */

export interface VersionInfo {
    version: string;
    label: string;
    link: string;
    isCurrent?: boolean;
}

// 版本列表配置
// 自动从 Git 标签同步，保留最近 10 个版本
export const versions: VersionInfo[] = [
${versionsCode}
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
    const match = path.match(/^\\/v(\\d+\\.\\d+\\.\\d+)\\//);
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
`;
}

function main() {
    console.log('🔄 Syncing versions from Git tags...');
    
    const currentVersion = getCurrentVersion();
    console.log(`📌 Current version: ${currentVersion}`);
    
    const tags = getGitTags();
    if (tags.length === 0) {
        console.log('⚠️  No version tags found, using current version only');
        const versions = [currentVersion];
        const content = generateVersionSelector(versions, currentVersion);
        fs.writeFileSync(versionSelectorPath, content, 'utf-8');
        console.log('✅ Updated version-selector.ts with current version only');
        return;
    }
    
    // 保留最近 10 个版本
    const recentVersions = tags.slice(0, 10);
    console.log(`📦 Found ${tags.length} versions, using recent ${recentVersions.length}:`);
    recentVersions.forEach(v => console.log(`   - v${v}`));
    
    const content = generateVersionSelector(recentVersions, currentVersion);
    fs.writeFileSync(versionSelectorPath, content, 'utf-8');
    
    console.log('✅ Successfully synced versions to version-selector.ts');
}

main();

