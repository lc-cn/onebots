/**
 * 中间件统一导出
 */

export {
    createRateLimit,
    createDefaultRateLimit,
    defaultRateLimit,
    type DefaultRateLimitOptions,
    type RateLimitConfig,
    type RateLimitMiddleware,
} from "./rate-limit.js";
export {
    initSecurityAudit,
    createSecurityAudit,
    securityAudit,
    logAuthFailure,
    logInvalidToken,
    logSuspiciousRequest,
    logRateLimit,
    closeSecurityAudit,
    type SecurityAuditMiddleware,
} from "./security-audit.js";
export {
    createTokenValidator,
    createConfigTokenValidator,
    createHMACValidator,
    createManagedTokenValidator,
    combineValidators,
} from "./token-validator.js";
export { metricsCollector } from "./metrics-collector.js";
export {
    TokenManager,
    initTokenManager,
    getTokenManager,
    type TokenInfo,
    type TokenManagerOptions,
} from "./token-manager.js";
