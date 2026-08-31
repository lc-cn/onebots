/**
 * VitePress 版本管理插件
 * 提供多版本文档管理功能
 */

import type { Plugin } from 'vite';
import type { UserConfig } from 'vitepress';

export interface VersionInfo {
    version: string;
    label: string;
    link: string;
    isCurrent?: boolean;
}

export interface VersioningPluginOptions {
    /**
     * 版本列表
     */
    versions: VersionInfo[];
    
    /**
     * 当前版本
     */
    currentVersion?: string;
    
    /**
     * 版本选择器在导航栏中的位置
     * 'start' | 'end' | number
     */
    position?: 'start' | 'end' | number;
}

/**
 * VitePress 版本管理插件
 */
export function versioningPlugin(options: VersioningPluginOptions): Plugin {
    const {
        versions = [],
        currentVersion,
        position = 'end'
    } = options;

    // 获取当前版本
    const current = versions.find(v => v.isCurrent) || 
                   versions.find(v => v.version === currentVersion) ||
                   versions[0];

    // 获取其他版本
    const otherVersions = versions.filter(v => !v.isCurrent && v.version !== current?.version);

    return {
        name: 'vitepress-plugin-versioning',
        enforce: 'pre',
        
        // 在配置解析时注入版本信息
        configResolved(config) {
            // 将版本信息注入到 Vite 环境变量中
            process.env.VITEPRESS_VERSIONS = JSON.stringify(versions);
            process.env.VITEPRESS_CURRENT_VERSION = current?.version || '';
        },
        
        // 生成版本选择器的客户端代码
        generateBundle() {
            // 这个钩子在构建时执行，可以生成静态文件
        }
    };
}

/**
 * VitePress 配置辅助函数
 * 用于在配置中自动添加版本选择器到导航栏
 */
export function withVersioning(
    config: UserConfig,
    options: VersioningPluginOptions
): UserConfig {
    const {
        versions = [],
        currentVersion,
        position = 'end'
    } = options;

    const current = versions.find(v => v.isCurrent) || 
                   versions.find(v => v.version === currentVersion) ||
                   versions[0];

    const otherVersions = versions.filter(v => !v.isCurrent && v.version !== current?.version);

    // 创建版本选择器导航项
    const versionNavItem = {
        text: current?.label || `v${current?.version || 'latest'}`,
        items: [
            // 当前版本
            {
                text: `${current?.label || `v${current?.version}`} (当前)`,
                link: current?.link || '/'
            },
            // 其他版本
            ...otherVersions.map(v => ({
                text: v.label,
                link: v.link
            })),
            // 分隔线（如果有其他版本）
            ...(otherVersions.length > 0 ? [{
                text: '---',
                link: '#'
            }] : []),
        ]
    };

    // 递归处理所有 locale 配置
    const processLocales = (locales: any) => {
        if (!locales) return;

        if (Array.isArray(locales)) {
            locales.forEach(processLocales);
            return;
        }

        if (typeof locales === 'object') {
            // 处理每个 locale
            Object.keys(locales).forEach(key => {
                const locale = locales[key];
                if (locale?.themeConfig?.nav) {
                    const nav = locale.themeConfig.nav;
                    
                    // 根据 position 插入版本选择器
                    if (position === 'start') {
                        nav.unshift(versionNavItem);
                    } else if (position === 'end') {
                        nav.push(versionNavItem);
                    } else if (typeof position === 'number') {
                        nav.splice(position, 0, versionNavItem);
                    }
                }
            });
        }
    };

    // 处理根配置
    if (config.locales) {
        processLocales(config.locales);
    } else if (config.themeConfig?.nav) {
        const nav = config.themeConfig.nav;
        if (position === 'start') {
            nav.unshift(versionNavItem);
        } else if (position === 'end') {
            nav.push(versionNavItem);
        } else if (typeof position === 'number') {
            nav.splice(position, 0, versionNavItem);
        }
    }

    return config;
}

