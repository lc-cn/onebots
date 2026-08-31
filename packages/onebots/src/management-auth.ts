import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { BaseApp, TokenInfo, TokenManager } from "@onebots/core";

export interface ManagementAuthHost {
    config: BaseApp.Config;
    tokenManager: Pick<TokenManager, "validateToken">;
}

export type ManagementTokenValidation =
    | { valid: false }
    | { valid: true; source: "configured"; info?: undefined }
    | { valid: true; source: "session"; info: TokenInfo };

/** 从 Authorization 或 query 中读取管理令牌，供 HTTP upgrade 与连接复检共用。 */
export function extractManagementToken(request: IncomingMessage): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        return (match ? match[1] : authHeader).trim() || undefined;
    }
    try {
        const url = new URL(request.url || "/", "http://localhost");
        return url.searchParams.get("access_token")?.trim() || undefined;
    } catch {
        return undefined;
    }
}

/** 动态读取当前配置；静态 access token 与用户名登录产生的会话令牌可同时使用。 */
export function validateManagementToken(
    host: ManagementAuthHost,
    token: string | undefined,
): ManagementTokenValidation {
    if (!token) return { valid: false };
    const expected = configuredManagementAccessToken(host.config);
    if (expected && secretEquals(token, expected)) {
        return { valid: true, source: "configured" };
    }
    const managed = host.tokenManager.validateToken(token);
    return managed.valid && managed.info
        ? { valid: true, source: "session", info: managed.info }
        : { valid: false };
}

export function authorizeManagementUpgrade(
    host: ManagementAuthHost,
    request: IncomingMessage,
): boolean {
    return validateManagementToken(host, extractManagementToken(request)).valid;
}

/** 登录始终使用热重载后的当前凭据，并以常量时间比较两个秘密字段。 */
export function managementCredentialsMatch(
    config: BaseApp.Config,
    username: string | undefined,
    password: string | undefined,
): boolean {
    const expectedUsername = config.username;
    const expectedPassword = config.password;
    return (
        !!username &&
        !!password &&
        !!expectedUsername &&
        !!expectedPassword &&
        secretEquals(username, expectedUsername) &&
        secretEquals(password, expectedPassword)
    );
}

export function configuredManagementAccessToken(config: BaseApp.Config): string | undefined {
    return (
        config.access_token?.trim() || process.env.ONEBOTS_ACCESS_TOKEN?.trim() || undefined
    );
}

export function managementAccessTokenMatches(
    config: BaseApp.Config,
    candidate: string | undefined,
): boolean {
    const expected = configuredManagementAccessToken(config);
    return !!candidate && !!expected && secretEquals(candidate, expected);
}

/** 判断一次成功热重载是否轮换了管理认证材料。 */
export function managementCredentialsChanged(
    previous: BaseApp.Config,
    next: BaseApp.Config,
): boolean {
    return (
        previous.username !== next.username ||
        previous.password !== next.password ||
        previous.access_token?.trim() !== next.access_token?.trim()
    );
}

function secretEquals(actual: string, expected: string): boolean {
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return (
        actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
    );
}
