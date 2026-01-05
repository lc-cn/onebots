/**
 * 中间件统一导出
 */

export { createRateLimit, defaultRateLimit } from './rate-limit.js';
export {
    initSecurityAudit,
    securityAudit,
    logAuthFailure,
    logInvalidToken,
    logSuspiciousRequest,
    logRateLimit,
    closeSecurityAudit,
} from './security-audit.js';
export {
    createTokenValidator,
    createConfigTokenValidator,
    createHMACValidator,
    createManagedTokenValidator,
    combineValidators,
} from './token-validator.js';
export { metricsCollector } from './metrics-collector.js';
export {
    TokenManager,
    initTokenManager,
    getTokenManager,
    type TokenInfo,
    type TokenManagerOptions,
} from './token-manager.js';

