import { EXTENSION_CATALOG, type ExtensionCatalogEntry } from "./extension-catalog.js";
import { validateExtensionCatalogIntegrity } from "./extension-catalog-integrity.js";
import { validateExtensionConfigurationTarget } from "./extension-configuration-target.js";
import type { DoctorCheck } from "./doctor.js";

/** 验证扩展目录承诺的配置入口，供人工诊断与 JSON 诊断共享。 */
export function inspectExtensionCatalog(
    entries: readonly ExtensionCatalogEntry[] = EXTENSION_CATALOG,
    integrityIssues: readonly string[] = validateExtensionCatalogIntegrity(entries),
): DoctorCheck {
    const targetIssues = entries.flatMap(entry => {
        const message = validateExtensionConfigurationTarget(entry);
        return message ? [`${entry.id}: ${message}`] : [];
    });
    const issues = [...targetIssues, ...integrityIssues];

    if (issues.length > 0) {
        return {
            name: "extension-catalog",
            level: "error",
            message: `发现 ${issues.length} 个扩展目录问题：${issues.join("；")}`,
        };
    }

    const adapters = entries.filter(entry => entry.type === "adapter").length;
    const protocols = entries.length - adapters;
    return {
        name: "extension-catalog",
        level: "ok",
        message: `扩展目录闭合有效：${adapters} 个适配器，${protocols} 个协议`,
    };
}
