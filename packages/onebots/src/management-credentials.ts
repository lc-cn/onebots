import { randomBytes } from "node:crypto";

export interface EnsuredManagementCredentials {
    config: Record<string, unknown>;
    generated: boolean;
}

/** 为没有完整管理凭据的配置生成高熵静态鉴权码。 */
export function ensureManagementCredentials(
    config: Record<string, unknown>,
    generateToken: () => string = () => randomBytes(32).toString("hex"),
): EnsuredManagementCredentials {
    if (hasText(config.access_token) || (hasText(config.username) && hasText(config.password))) {
        return { config, generated: false };
    }

    const accessToken = generateToken().trim();
    if (!accessToken) throw new Error("管理端鉴权码生成器返回了空值");
    return {
        config: { ...config, access_token: accessToken },
        generated: true,
    };
}

function hasText(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}
