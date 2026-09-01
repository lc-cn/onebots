import { randomBytes } from "node:crypto";

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
