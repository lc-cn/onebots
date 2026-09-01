import type { SystemInfo } from "./types.js";
import {
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

export interface SystemInfoSnapshot {
    identity: ManagementEvidenceIdentity;
    info: SystemInfo;
}

/** 验证系统快照自身身份、配置状态和插件清单，再允许页面采用。 */
export function parseSystemInfoSnapshot(
    response: Pick<Response, "headers">,
    value: unknown,
): SystemInfoSnapshot {
    const identity = parseManagementEvidenceIdentity(response);
    if (!isRecord(value)) throw new Error("系统信息响应必须是对象");
    const bodyIdentity = readBodyIdentity(value);
    if (!bodyIdentity || !sameManagementEvidenceIdentity(identity, bodyIdentity)) {
        throw new Error("系统信息正文与响应实例身份不一致");
    }
    if (!isRuntimeConfigState(value.configState)) {
        throw new Error("系统信息缺少有效配置状态");
    }
    if (!Array.isArray(value.plugins)) throw new Error("系统信息缺少运行时插件清单");
    const pluginIds = new Set<string>();
    for (const plugin of value.plugins) {
        if (
            !isRecord(plugin) ||
            (plugin.type !== "adapter" && plugin.type !== "protocol") ||
            !nonEmptyString(plugin.name) ||
            !nonEmptyString(plugin.packageName) ||
            !(plugin.version === null || nonEmptyString(plugin.version)) ||
            !nonEmptyString(plugin.entryPath)
        ) {
            throw new Error("系统信息包含无效运行时插件条目");
        }
        const id = `${plugin.type}:${plugin.name}`;
        if (pluginIds.has(id)) throw new Error(`系统信息包含重复运行时插件: ${id}`);
        pluginIds.add(id);
    }
    return { identity, info: value as unknown as SystemInfo };
}

function readBodyIdentity(value: Record<string, unknown>): ManagementEvidenceIdentity | null {
    const application = nonEmptyString(value.application_name);
    const version = nonEmptyString(value.application_version);
    const instanceId = nonEmptyString(value.instance_id);
    const runtimeContractId = nonEmptyString(value.runtime_contract_id);
    return application && version && instanceId && runtimeContractId
        ? { application, version, instanceId, runtimeContractId }
        : null;
}

function isRuntimeConfigState(value: unknown): boolean {
    return (
        isRecord(value) &&
        ["in_sync", "drifted", "unavailable"].includes(String(value.status)) &&
        Boolean(nonEmptyString(value.appliedAt)) &&
        typeof value.message === "string"
    );
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
