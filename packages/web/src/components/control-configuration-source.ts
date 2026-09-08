import type {
    ControlConfigurationBase,
    ControlConfigurationDraft,
    ControlConfigurationSnapshot,
} from "@onebots/core/control";
import { configurationRequest } from "./control-configuration-recovery.js";
export interface ConfigurationSource {
    state: "ready" | "damaged";
    base: ControlConfigurationBase;
    reason?: "INVALID_YAML";
    repairAvailable?: boolean;
}
export interface ConfigurationDraftContext {
    draft: ControlConfigurationDraft;
    schemas: Record<string, unknown>;
}
export interface ConfigurationSourceClient {
    configurationSnapshot(): Promise<ControlConfigurationSnapshot>;
    configurationSource(): Promise<ConfigurationSource>;
    configurationDraftContext(id: string): Promise<ConfigurationDraftContext>;
    createConfigurationRepairDraft(
        base: ControlConfigurationBase,
    ): Promise<ConfigurationDraftContext>;
}
export interface ConfigurationPanelSource {
    snapshot?: ControlConfigurationSnapshot;
    context?: ConfigurationDraftContext;
    source?: ConfigurationSource;
    draftUnavailable?: boolean;
}
/** 读取已有草稿不依赖正常snapshot；任何读取路径都不隐式创建修复草稿。 */
export async function loadConfigurationPanelSource(
    client: ConfigurationSourceClient,
    draftId?: string,
): Promise<ConfigurationPanelSource> {
    if (draftId) {
        try {
            return {
                context: await configurationRequest(client.configurationDraftContext(draftId)),
            };
        } catch {
            /* 旧草稿可能过期；继续只读查询来源，不丢弃原操作标识。 */
        }
    }
    try {
        return {
            snapshot: await configurationRequest(client.configurationSnapshot()),
            draftUnavailable: Boolean(draftId),
        };
    } catch {
        const source = await configurationRequest(client.configurationSource());
        if (source.state !== "damaged" || source.reason !== "INVALID_YAML")
            throw new Error("配置暂不可读取");
        return { source, draftUnavailable: Boolean(draftId) };
    }
}
export async function createConfirmedConfigurationRepair(
    client: ConfigurationSourceClient,
    source: ConfigurationSource | undefined,
    confirmed: boolean,
): Promise<ConfigurationDraftContext> {
    if (
        !confirmed ||
        source?.state !== "damaged" ||
        source.reason !== "INVALID_YAML" ||
        source.repairAvailable !== true
    )
        throw new Error("请先明确确认配置修复");
    return configurationRequest(client.createConfigurationRepairDraft(source.base));
}
