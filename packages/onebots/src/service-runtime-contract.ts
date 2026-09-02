import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";

export interface ServiceRuntimeContract {
    configPath: string;
    adapters: string[];
    protocols: string[];
    applications?: string[];
    nodePath: string;
    binPath: string;
    workingDirectory: string;
}

/** 将完整启动契约转换为可公开比对且不直接包含本机路径的稳定摘要。 */
export function createServiceRuntimeContractId(contract: ServiceRuntimeContract): string {
    const canonical = JSON.stringify({
        configPath: path.resolve(contract.configPath),
        adapters: [...contract.adapters],
        protocols: [...contract.protocols],
        applications: [...(contract.applications ?? [])],
        nodePath: path.resolve(contract.nodePath),
        binPath: path.resolve(contract.binPath),
        workingDirectory: path.resolve(contract.workingDirectory),
    });
    return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** 按服务入口的真实优先级解析当前配置中的插件选择，再生成期望契约摘要。 */
export function resolveServiceRuntimeContractId(spec: ServiceSpec): string {
    let adapters = spec.adapters;
    let protocols = spec.protocols;
    let applications = spec.applications ?? [];
    if (fs.existsSync(spec.configPath)) {
        const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
        const selection = getRuntimePluginSelection(config);
        if (selection) {
            adapters = selection.adapters;
            protocols = selection.protocols;
            applications = selection.applications ?? applications;
        }
    }
    return createServiceRuntimeContractId({ ...spec, adapters, protocols, applications });
}
