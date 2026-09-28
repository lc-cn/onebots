export const SESSION_DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * SESSION_DAY;
export const ATTEMPT_LIMIT = 5;
export const SESSION_DAYS = [30, 90, 365] as const;

export interface SessionPolicy {
    durationDays: 30 | 90 | 365;
    autoRenew: boolean;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = { durationDays: 30, autoRenew: true };

export function validSessionPolicy(value: unknown): value is SessionPolicy {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const policy = value as Record<string, unknown>;
    return (
        Object.keys(policy).sort().join(",") === "autoRenew,durationDays" &&
        SESSION_DAYS.some(days => days === policy.durationDays) &&
        typeof policy.autoRenew === "boolean"
    );
}

/** 旧会话没有 renewedAt；其固定 30 天期限不能在迁移时偷偷延长。 */
export function validSessionLifetime(value: Record<string, unknown>): boolean {
    const issuedAt = value.issuedAt;
    const renewedAt = value.renewedAt ?? issuedAt;
    const expiresAt = value.expiresAt;
    return (
        typeof issuedAt === "number" &&
        Number.isSafeInteger(issuedAt) &&
        issuedAt >= 0 &&
        typeof renewedAt === "number" &&
        Number.isSafeInteger(renewedAt) &&
        renewedAt >= issuedAt &&
        typeof expiresAt === "number" &&
        Number.isSafeInteger(expiresAt) &&
        SESSION_DAYS.some(days => expiresAt - renewedAt === days * SESSION_DAY) &&
        (value.renewedAt !== undefined || expiresAt - issuedAt === 30 * SESSION_DAY)
    );
}
