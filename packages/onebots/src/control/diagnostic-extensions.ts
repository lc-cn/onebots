import fs from "node:fs";
import path from "node:path";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { readGenerationPlan } from "../installation/generation-runtime.js";
import { readGenerationConfigurationSchema } from "../configuration/configuration-runtime-schema.js";
import { parseConfigurationDocument } from "../configuration/configuration-document.js";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";

export interface DiagnosticExtensions {
    receipt: "bundled" | "verified" | "invalid" | "unavailable";
    selection: "ready" | "mismatch" | "unavailable";
    registration: "verified" | "not-checked";
}
/**
 * selection 仅证明启动扩展选择与收据一致，不证明账号字段或协议连接配置可运行。
 * registration 仅指既有收据中的注册证据；此调用不执行插件或验证worker。
 */
export function inspectDiagnosticExtensions(
    workspace: string,
    document: Record<string, unknown> | null,
    activeId: string | null,
    readVerified?: (id: string) => VerifiedGeneration,
): DiagnosticExtensions {
    const result: DiagnosticExtensions = {
        receipt: activeId === null ? "bundled" : "unavailable",
        selection: "unavailable",
        registration: "not-checked",
    };
    let available: { adapters: string[]; protocols: string[]; applications: string[] } | undefined;
    if (activeId !== null) {
        if (!readVerified) return result;
        try {
            const generation = readVerified(activeId);
            if (
                generation.id !== activeId ||
                generation.directory !==
                    path.join(fs.realpathSync(workspace), ".control", "generations", activeId)
            )
                throw new Error();
            const plan = readGenerationPlan(generation);
            const schemas = readGenerationConfigurationSchema(
                { readVerified: () => generation },
                activeId,
            );
            const registered = {
                adapters: Object.keys(schemas.adapters),
                protocols: Object.values(schemas.protocolRegistrations),
                applications: Object.keys(schemas.applications),
            };
            for (const type of ["adapters", "protocols", "applications"] as const) {
                if (!sameSet(plan.selection[type], registered[type])) throw new Error();
            }
            available = plan.selection;
            result.receipt = "verified";
        } catch {
            return { ...result, receipt: "invalid" };
        }
    }
    if (document === null) return result;
    try {
        const parsed = parseConfigurationDocument(document);
        const selection = getConfiguredPluginSelection(parsed, true);
        if (!selection) return result;
        const configured = { ...selection, applications: selection.applications ?? [] };
        // 与现有旧配置推导规则一致，明确引用账号/协议不能被显式空 plugins 隐藏。
        const { plugins: _plugins, ...references } = parsed;
        const referenced = getConfiguredPluginSelection(references, true)!;
        if (
            ["adapters", "protocols"].some(type => {
                const key = type as "adapters" | "protocols";
                return referenced[key].some(name => !configured[key].includes(name));
            })
        )
            return { ...result, selection: "mismatch" };

        if (!available) {
            if (Object.values(configured).every(names => names.length === 0))
                result.selection = "ready";
        } else {
            result.selection = (["adapters", "protocols", "applications"] as const).every(type =>
                configured[type].every(name => available![type].includes(name)),
            )
                ? "ready"
                : "mismatch";
            if (result.selection === "ready") result.registration = "verified";
        }
    } catch {
        /* 配置无效仅报告不可确认，不回显字段和值。 */
    }
    return result;
}
function sameSet(left: string[], right: string[]): boolean {
    return new Set(left).size === new Set(right).size && left.every(value => right.includes(value));
}
