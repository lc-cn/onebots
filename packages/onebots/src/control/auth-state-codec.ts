import { HASH, digest } from "./auth-crypto.js";
import { DEFAULT_SESSION_POLICY, SESSION_TTL } from "./auth-policy.js";
import { validState } from "./auth-state-validation.js";
import type { AuthState } from "./auth.js";

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 旧格式只读解码；补字段不落盘，也不为旧状态声明任何工作区来源。 */
export function decodeLegacyAuthenticationState(value: unknown, now: number): AuthState {
    if (!record(value) || (value.version !== 1 && value.version !== 2))
        throw new Error("控制认证失败");
    const state = { ...value };
    if (state.version === 1 && !Object.hasOwn(state, "sessionLifetime"))
        state.sessionLifetime = null;
    if (!Object.hasOwn(state, "deploymentBootstrap")) state.deploymentBootstrap = null;
    if (!Object.hasOwn(state, "deploymentBootstrapHistory"))
        state.deploymentBootstrapHistory = record(state.deploymentBootstrap)
            ? [state.deploymentBootstrap.hash]
            : [];
    if (!Object.hasOwn(state, "deploymentRecovery")) state.deploymentRecovery = null;
    if (!Object.hasOwn(state, "deploymentRecoveryHistory")) state.deploymentRecoveryHistory = [];
    if (!Object.hasOwn(state, "recovery")) state.recovery = null;
    if (!Object.hasOwn(state, "issuance")) state.issuance = { startedAt: now, count: 0 };
    if (state.version === 1) {
        if (
            Object.hasOwn(state, "sessions") ||
            Object.hasOwn(state, "device") ||
            !validLegacySession(state) ||
            (!state.paired && state.sessionHash !== null)
        )
            throw new Error("控制认证失败");
        const lifetime = state.sessionLifetime;
        state.sessions =
            typeof state.sessionHash === "string" && record(lifetime)
                ? [
                      {
                          id: digest(`device:${state.sessionHash}`).slice(0, 32),
                          hash: state.sessionHash,
                          issuedAt: lifetime.issuedAt,
                          expiresAt: lifetime.expiresAt,
                      },
                  ]
                : [];
        delete state.sessionHash;
        delete state.sessionLifetime;
        state.device = null;
        state.version = 2;
    }
    if (!validState(state) || state.version !== 2) throw new Error("控制认证失败");
    return state;
}

export function emptyAuthenticationState(now: number): AuthState {
    return {
        version: 2,
        paired: false,
        deploymentBootstrap: null,
        deploymentBootstrapHistory: [],
        deploymentRecovery: null,
        deploymentRecoveryHistory: [],
        bootstrap: null,
        recovery: null,
        issuance: { startedAt: now, count: 0 },
        device: null,
        sessions: [],
        sessionPolicy: DEFAULT_SESSION_POLICY,
        attempts: { startedAt: now, count: 0 },
    };
}

function validLegacySession(value: Record<string, unknown>): boolean {
    if (
        value.sessionHash !== null &&
        (typeof value.sessionHash !== "string" || !HASH.test(value.sessionHash))
    )
        return false;
    if (value.sessionLifetime !== null) {
        const lifetime = value.sessionLifetime;
        if (
            value.sessionHash === null ||
            !record(lifetime) ||
            typeof lifetime.issuedAt !== "number" ||
            !Number.isSafeInteger(lifetime.issuedAt) ||
            lifetime.issuedAt < 0 ||
            typeof lifetime.expiresAt !== "number" ||
            !Number.isSafeInteger(lifetime.expiresAt) ||
            lifetime.expiresAt - lifetime.issuedAt !== SESSION_TTL
        )
            return false;
    }
    return true;
}
