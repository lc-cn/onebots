import { HASH } from "./auth-crypto.js";
import { ATTEMPT_LIMIT, validSessionLifetime, validSessionPolicy } from "./auth-policy.js";
import type { AuthState } from "./auth.js";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 状态文件是认证边界：拒绝混合代际字段、重复凭据及不可能的期限。 */
export function validState(value: unknown): value is AuthState {
    if (
        !record(value) ||
        value.version !== 2 ||
        typeof value.paired !== "boolean" ||
        Object.hasOwn(value, "sessionHash") ||
        Object.hasOwn(value, "sessionLifetime")
    )
        return false;
    if (
        !Array.isArray(value.sessions) ||
        value.sessions.length > 16 ||
        value.sessions.some(
            session =>
                !record(session) ||
                typeof session.id !== "string" ||
                !/^[a-f0-9]{32}$/.test(session.id) ||
                typeof session.hash !== "string" ||
                !HASH.test(session.hash) ||
                !validSessionLifetime(session),
        ) ||
        new Set(value.sessions.map(session => session.id)).size !== value.sessions.length ||
        new Set(value.sessions.map(session => session.hash)).size !== value.sessions.length
    )
        return false;
    for (const challenge of [
        value.bootstrap,
        value.recovery,
        value.device,
        value.deploymentBootstrap,
        value.deploymentRecovery,
    ]) {
        if (challenge === null) continue;
        if (
            !record(challenge) ||
            typeof challenge.hash !== "string" ||
            !HASH.test(challenge.hash) ||
            typeof challenge.expiresAt !== "number" ||
            !Number.isSafeInteger(challenge.expiresAt)
        )
            return false;
    }
    for (const [history, challenge] of [
        [value.deploymentBootstrapHistory, value.deploymentBootstrap],
        [value.deploymentRecoveryHistory, value.deploymentRecovery],
    ]) {
        if (
            !Array.isArray(history) ||
            history.length > 16 ||
            history.some(hash => typeof hash !== "string" || !HASH.test(hash)) ||
            new Set(history).size !== history.length ||
            (challenge !== null && (!record(challenge) || !history.includes(challenge.hash)))
        )
            return false;
    }
    const bootstrapHistory = value.deploymentBootstrapHistory;
    const recoveryHistory = value.deploymentRecoveryHistory;
    if (
        !Array.isArray(bootstrapHistory) ||
        !Array.isArray(recoveryHistory) ||
        bootstrapHistory.some(hash => recoveryHistory.includes(hash)) ||
        (!value.paired && (value.deploymentRecovery !== null || recoveryHistory.length > 0))
    )
        return false;
    if (value.paired ? value.bootstrap !== null : value.sessions.length !== 0) return false;
    if (value.sessionPolicy !== undefined && !validSessionPolicy(value.sessionPolicy)) return false;
    if (!value.paired && (value.recovery !== null || value.device !== null)) return false;
    if (
        !record(value.issuance) ||
        !Number.isSafeInteger(value.issuance.startedAt) ||
        !Number.isInteger(value.issuance.count) ||
        typeof value.issuance.count !== "number" ||
        value.issuance.count < 0 ||
        value.issuance.count > ATTEMPT_LIMIT
    )
        return false;
    return (
        record(value.attempts) &&
        typeof value.attempts.startedAt === "number" &&
        Number.isSafeInteger(value.attempts.startedAt) &&
        typeof value.attempts.count === "number" &&
        Number.isInteger(value.attempts.count) &&
        value.attempts.count >= 0 &&
        value.attempts.count <= ATTEMPT_LIMIT
    );
}
