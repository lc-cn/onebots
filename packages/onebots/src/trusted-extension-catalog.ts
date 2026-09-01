import {
    EXTENSION_CATALOG,
    type ExtensionCatalogEntry,
    type ExtensionSetupStep,
} from "./extension-catalog.js";

/**
 * 宿主在加载任何第三方插件前捕获的深冻结扩展目录。
 *
 * 原始导出仍服务生成脚本和兼容调用方；运行时安全边界只消费本快照，避免插件通过
 * 深导入修改安装白名单、配置入口或引导链接。
 */
export const TRUSTED_EXTENSION_CATALOG: readonly ExtensionCatalogEntry[] = Object.freeze(
    EXTENSION_CATALOG.map(snapshotExtensionCatalogEntry),
);

export function getTrustedExtensionCatalogEntry(id: string): ExtensionCatalogEntry | undefined {
    return TRUSTED_EXTENSION_CATALOG.find(entry => entry.id === id);
}

function snapshotExtensionCatalogEntry(entry: ExtensionCatalogEntry): ExtensionCatalogEntry {
    const setup = entry.setup.map(snapshotSetupStep);
    Object.freeze(setup);
    const configurationTarget = Object.freeze({ ...entry.configurationTarget });
    return Object.freeze({
        ...entry,
        configurationTarget,
        setup,
    });
}

function snapshotSetupStep(step: ExtensionSetupStep): ExtensionSetupStep {
    return Object.freeze({ ...step });
}
