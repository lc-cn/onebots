import { randomBytes } from "node:crypto";
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface EnsuredManagementCredentials {
    config: Record<string, unknown>;
    generated: boolean;
    source: "config" | "environment" | "generated";
}

/** 判断当前配置或部署环境是否已经提供完整管理凭据。 */
export function hasManagementCredentials(
    config: Record<string, unknown>,
    environmentToken: string | undefined = process.env.ONEBOTS_ACCESS_TOKEN,
): boolean {
    return (
        hasText(environmentToken) ||
        hasText(config.access_token) ||
        (hasText(config.username) && hasText(config.password))
    );
}

/** 生成不受当前 shell 环境影响的持久化管理凭据证据。 */
export function inspectPersistedManagementCredentials(
    config: Record<string, unknown>,
): DoctorCheck {
    const persisted = hasManagementCredentials(config, "");
    return {
        name: "service-credentials",
        level: persisted ? "ok" : "error",
        message: persisted
            ? "服务配置包含持久化管理凭据"
            : "服务配置缺少持久化管理凭据；当前 shell 的 ONEBOTS_ACCESS_TOKEN 不会写入服务定义，请将凭据写入配置或取消该环境变量后执行 onebots setup --force",
    };
}

/** 为没有完整管理凭据的配置生成高熵静态鉴权码。 */
export function ensureManagementCredentials(
    config: Record<string, unknown>,
    generateToken: () => string = () => randomBytes(32).toString("hex"),
    environmentToken: string | undefined = process.env.ONEBOTS_ACCESS_TOKEN,
): EnsuredManagementCredentials {
    if (hasText(environmentToken)) {
        return { config, generated: false, source: "environment" };
    }
    if (hasManagementCredentials(config, "")) {
        return { config, generated: false, source: "config" };
    }

    const accessToken = generateToken().trim();
    if (!accessToken) throw new Error("管理端鉴权码生成器返回了空值");
    return {
        config: { ...config, access_token: accessToken },
        generated: true,
        source: "generated",
    };
}

function hasText(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}
