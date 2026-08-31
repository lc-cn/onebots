/**
 * 访问令牌验证中间件
 * 支持多种令牌格式和验证方式
 */

import type { Context, Next } from "koa";
import { createLogger } from "../logger.js";
import { logInvalidToken, logAuthFailure } from "./security-audit.js";
import crypto from "crypto";

const logger = createLogger("TokenValidator");

export interface TokenConfig {
    /** 令牌名称（用于从 header 或 query 中获取） */
    tokenName?: string;
    /** 是否从 Authorization header 获取 */
    fromHeader?: boolean;
    /** 是否从 query 参数获取 */
    fromQuery?: boolean;
    /** 验证函数 */
    validator?: (token: string, ctx: Context) => boolean | Promise<boolean>;
    /** 是否必需 */
    required?: boolean;
    /** 自定义错误消息 */
    errorMessage?: string;
}

/**
 * 创建令牌验证中间件
 */
export function createTokenValidator(config: TokenConfig = {}) {
    const {
        tokenName = "access_token",
        fromHeader = true,
        fromQuery = true,
        validator,
        required = true,
        errorMessage = "Invalid or missing access token",
    } = config;

    return async (ctx: Context, next: Next) => {
        const token = extractToken(ctx, { tokenName, fromHeader, fromQuery });

        // 检查令牌是否存在
        if (!token) {
            if (required) {
                logInvalidToken(ctx);
                ctx.status = 401;
                ctx.body = {
                    error: "Unauthorized",
                    message: errorMessage,
                };
                return;
            } else {
                // 可选令牌，继续执行
                return next();
            }
        }

        // 验证令牌
        let isValid = true;

        if (validator) {
            try {
                isValid = await validator(token, ctx);
            } catch (error: unknown) {
                logger.error("Token validation error", {
                    error: error instanceof Error ? error.message : String(error),
                    path: ctx.path,
                });
                isValid = false;
            }
        } else {
            // 默认验证：检查令牌不为空
            isValid = token.length > 0;
        }

        if (!isValid) {
            logInvalidToken(ctx, token);
            ctx.status = 401;
            ctx.body = {
                error: "Unauthorized",
                message: errorMessage,
            };
            return;
        }

        // 将令牌存储到 context 中，供后续使用
        ctx.state.token = token;

        await next();
    };
}

/**
 * 创建基于配置的令牌验证器
 * 从配置中读取 access_token 列表进行验证
 */
export function createConfigTokenValidator(expectedTokens: string[]) {
    const tokenSet = new Set(expectedTokens.filter(Boolean));

    return createTokenValidator({
        validator: (token: string) => {
            return tokenSet.has(token);
        },
    });
}

/**
 * HMAC 签名验证
 */
export function createHMACValidator(secret: string, algorithm: string = "sha256") {
    return async (ctx: Context, next: Next) => {
        const signature = ctx.get("x-signature") || (ctx.query.signature as string | undefined);

        if (!signature) {
            logAuthFailure(ctx, "Missing signature");
            ctx.status = 401;
            ctx.body = {
                error: "Unauthorized",
                message: "Missing signature",
            };
            return;
        }

        // 获取请求体
        const body = ctx.request.body || ctx.request.rawBody || "";
        const bodyString = typeof body === "string" ? body : JSON.stringify(body);

        // 计算 HMAC
        const hmac = crypto.createHmac(algorithm, secret);
        hmac.update(bodyString);
        const expectedSignature = hmac.digest("hex");

        // 使用时间安全比较
        const signatureBuffer = /^[\da-f]+$/iu.test(signature)
            ? Buffer.from(signature, "hex")
            : Buffer.alloc(0);
        const expectedBuffer = Buffer.from(expectedSignature, "hex");
        const isValid =
            signatureBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

        if (!isValid) {
            logAuthFailure(ctx, "Invalid signature");
            ctx.status = 401;
            ctx.body = {
                error: "Unauthorized",
                message: "Invalid signature",
            };
            return;
        }

        await next();
    };
}

/**
 * 创建带令牌管理的验证器
 * 支持令牌过期检查和自动刷新
 */
export function createManagedTokenValidator(
    tokenManager: import("./token-manager.js").TokenManager,
    config: TokenConfig = {},
) {
    return async (ctx: Context, next: Next) => {
        const token = extractToken(ctx, config);

        if (!token) {
            if (config.required !== false) {
                logInvalidToken(ctx);
                ctx.status = 401;
                ctx.body = {
                    error: "Unauthorized",
                    message: config.errorMessage || "Invalid or missing access token",
                };
                return;
            }
            return next();
        }

        // 验证令牌
        const validation = tokenManager.validateToken(token);

        if (!validation.valid) {
            if (validation.expired) {
                logInvalidToken(ctx, token);
                ctx.status = 401;
                ctx.body = {
                    error: "Unauthorized",
                    message: "Token expired",
                    code: "TOKEN_EXPIRED",
                };
                return;
            } else {
                logInvalidToken(ctx, token);
                ctx.status = 401;
                ctx.body = {
                    error: "Unauthorized",
                    message: config.errorMessage || "Invalid access token",
                };
                return;
            }
        }

        if (config.validator) {
            let accepted = false;
            try {
                accepted = await config.validator(token, ctx);
            } catch (error) {
                logger.error("Managed token validation error", {
                    error: error instanceof Error ? error.message : String(error),
                    path: ctx.path,
                });
            }
            if (!accepted) {
                logInvalidToken(ctx, token);
                ctx.status = 401;
                ctx.body = {
                    error: "Unauthorized",
                    message: config.errorMessage || "Invalid access token",
                };
                return;
            }
        }

        // 将令牌信息存储到 context
        ctx.state.token = token;
        ctx.state.tokenInfo = validation.info;

        await next();
    };
}

/** 按公开配置从单一位置提取令牌，拒绝多值 query，避免各验证器语义漂移。 */
function extractToken(ctx: Context, config: TokenConfig): string | undefined {
    const fromHeader = config.fromHeader ?? true;
    const fromQuery = config.fromQuery ?? true;
    if (fromHeader) {
        const authorization = ctx.get("authorization");
        if (authorization) {
            return authorization.replace(/^Bearer\s+/iu, "").trim() || undefined;
        }
    }
    if (!fromQuery) return undefined;
    const value = ctx.query[config.tokenName ?? "access_token"];
    return typeof value === "string" && value ? value : undefined;
}

/**
 * 组合多个验证器
 */
export function combineValidators(
    ...validators: Array<(ctx: Context, next: Next) => Promise<void>>
) {
    return async (ctx: Context, next: Next) => {
        for (const validator of validators) {
            await validator(ctx, async () => {
                // 空函数，用于链式调用
            });

            // 如果验证失败，响应已设置，直接返回
            if (ctx.status === 401) {
                return;
            }
        }

        // 所有验证通过，继续执行
        await next();
    };
}
