import path from "node:path";
import type { ServiceSpec } from "./service-definition.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration/configuration-document.js";

export interface ServiceMigrationConfig {
    document: ConfigurationDocument;
    sourceConfigPath: string;
    targetConfigPath: string;
    dataDirectory: string;
    selection: { adapters: string[]; protocols: string[]; applications: string[] };
}

/**
 * 纯候选：按旧 --service-runtime 的实际优先级迁移，不按公开CLI的显式参数优先级。
 * 调用方先验证legacy；还须核验真实文件身份、环境差异及目标冲突，再执行持久化迁移。
 * 路径比较仅为词法同目录限制，不证明符号链接等价，不搬迁数据或自动切换服务。
 */
export function createServiceMigrationConfig(input: {
    document: unknown;
    legacy: ServiceSpec;
    workspace: string;
}): ServiceMigrationConfig {
    try {
        const document = parseConfigurationDocument(input.document);
        const legacy = parseConfigurationDocument(input.legacy);
        if (!absolute(input.workspace) || !absolute(legacy.configPath)) throw new Error();
        const workspace = path.normalize(input.workspace);
        const sourceConfigPath = path.normalize(legacy.configPath);
        if (path.dirname(sourceConfigPath) !== workspace) throw new Error();
        // 只用显式配置，绝不读取本进程ONEBOTS_CONTAINER等环境来推导旧服务选择。
        const configured = getRuntimePluginSelection(document);
        const fallback = getRuntimePluginSelection({
            plugins: {
                adapters: legacy.adapters,
                protocols: legacy.protocols,
                ...(legacy.applications !== undefined ? { applications: legacy.applications } : {}),
            },
        })!;
        // 旧argv不会trim；新plugins会规范化。不能静默改变带空格/重复的旧声明。
        for (const key of ["adapters", "protocols", "applications"] as const) {
            if (JSON.stringify(legacy[key] ?? []) !== JSON.stringify(fallback[key] ?? []))
                throw new Error();
        }
        const selection = configured
            ? {
                  adapters: configured.adapters,
                  protocols: configured.protocols,
                  applications: configured.applications ?? fallback.applications ?? [],
              }
            : {
                  adapters: fallback.adapters,
                  protocols: fallback.protocols,
                  applications: fallback.applications ?? [],
              };
        delete document.username;
        delete document.password;
        delete document.access_token;
        document.plugins = { ...selection };
        return {
            document,
            sourceConfigPath,
            targetConfigPath: path.join(workspace, "config.yaml"),
            dataDirectory: path.join(workspace, "data"),
            selection: structuredClone(selection),
        };
    } catch {
        // Schema异常可能带字段内容；此纯边界只返回固定诊断。
        throw new Error("旧服务配置迁移候选无效；仅支持同配置目录工作区");
    }
}
function absolute(value: unknown): value is string {
    return typeof value === "string" && path.isAbsolute(value) && !/[\u0000\r\n]/.test(value);
}
