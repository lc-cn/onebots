import { parseConfigurationDocument } from "../configuration/configuration-document.js";
import { getRuntimePluginSelection } from "../runtime-plugin-selection.js";
import { getTrustedExtensionCatalogEntry } from "../trusted-extension-catalog.js";
import type { GenerationSelection } from "../installation/generation-plan.js";

export type ExtensionRemovalReference =
    | "plugin-selection"
    | "account"
    | "general-protocol"
    | "account-protocol";

export interface ExtensionRemovalConflict {
    type: "adapter" | "protocol" | "application";
    name: string;
    references: ExtensionRemovalReference[];
}

export interface ExtensionRemovalConfirmation {
    selection: GenerationSelection;
    configRevision: string;
}

export class ExtensionRemovalConflictError extends Error {
    constructor(public readonly conflicts: ExtensionRemovalConflict[]) {
        super("扩展仍被当前配置引用，请先移除对应账号、协议配置或启用选择并应用配置");
    }
}

export function removedExtensions(
    current: GenerationSelection,
    target: GenerationSelection,
): GenerationSelection {
    return {
        adapters: current.adapters.filter(name => !target.adapters.includes(name)),
        protocols: current.protocols.filter(name => !target.protocols.includes(name)),
        applications: current.applications.filter(name => !target.applications.includes(name)),
    };
}

/** 移除只检查引用，不修改配置；调用方随后仍要走候选安装与显式激活。 */
export function assertExtensionsNotReferenced(
    removal: GenerationSelection,
    document: Record<string, unknown>,
): void {
    const config = parseConfigurationDocument(document);
    const configured = getRuntimePluginSelection(config) ?? {
        adapters: [],
        protocols: [],
        applications: [],
    };
    const conflicts: ExtensionRemovalConflict[] = [];
    for (const name of removal.adapters) {
        const references: ExtensionRemovalReference[] = [];
        if (configured.adapters.includes(name)) references.push("plugin-selection");
        if (Object.keys(config).some(key => key.startsWith(`${name}.`))) references.push("account");
        if (references.length) conflicts.push({ type: "adapter", name, references });
    }
    for (const name of removal.protocols) {
        const references: ExtensionRemovalReference[] = [];
        if (configured.protocols.includes(name)) references.push("plugin-selection");
        const entry = getTrustedExtensionCatalogEntry(`protocol:${name}`);
        const protocolKey =
            entry?.configurationTarget.kind === "protocol"
                ? entry.configurationTarget.protocolKey
                : undefined;
        if (protocolKey) {
            if (record(config.general) && Object.hasOwn(config.general, protocolKey))
                references.push("general-protocol");
            if (
                Object.entries(config).some(
                    ([key, value]) =>
                        key.includes(".") && record(value) && Object.hasOwn(value, protocolKey),
                )
            )
                references.push("account-protocol");
        }
        if (references.length) conflicts.push({ type: "protocol", name, references });
    }
    for (const name of removal.applications) {
        if (configured.applications?.includes(name))
            conflicts.push({ type: "application", name, references: ["plugin-selection"] });
    }
    if (conflicts.length) throw new ExtensionRemovalConflictError(conflicts);
}

export function hasExtensionRemoval(selection: GenerationSelection): boolean {
    return (
        selection.adapters.length + selection.protocols.length + selection.applications.length > 0
    );
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
