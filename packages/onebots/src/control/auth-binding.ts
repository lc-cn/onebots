import path from "node:path";
import { validState } from "./auth-state-validation.js";
import { decodeLegacyAuthenticationState, emptyAuthenticationState } from "./auth-state-codec.js";
import {
    authenticationBytes,
    authenticationDigest,
    readAuthenticationSnapshot,
    replaceAuthenticationState,
} from "./auth-binding-file.js";
import {
    validAuthenticationBindingContext,
    sameAuthenticationBindingContext,
    type AuthenticationBindingContext,
} from "./auth-binding-context.js";
import type { AuthState } from "./auth.js";

export type { AuthenticationBindingContext } from "./auth-binding-context.js";

export interface AuthenticationBindingPlan {
    previousDigest: string | null;
    targetDigest: string;
    targetState: unknown;
}
export type AuthBindingPlan = AuthenticationBindingPlan;

const FAILURE = "控制认证登记状态无法确认";
const DIGEST = /^[a-f0-9]{64}$/;
const stateFile = (workspace: string) => path.join(workspace, ".control", "auth.json");

/** 只读计划；目标交由卷外登记事务持久保存，不输出到日志或用户计划。 */
export function planAuthenticationBinding(
    workspace: string,
    context: AuthenticationBindingContext,
): AuthenticationBindingPlan {
    try {
        if (!validAuthenticationBindingContext(context)) throw new Error(FAILURE);
        const snapshot = readAuthenticationSnapshot(stateFile(workspace));
        const state = snapshot
            ? decodeLegacyAuthenticationState(
                  JSON.parse(snapshot.bytes.toString("utf8")),
                  Date.now(),
              )
            : emptyAuthenticationState(Date.now());
        const target: AuthState = {
            version: 3,
            bindingContext: { ...context },
            paired: state.paired,
            sessionPolicy: state.sessionPolicy,
            issuance: { ...state.issuance },
            attempts: { ...state.attempts },
            deploymentBootstrapHistory: [...state.deploymentBootstrapHistory],
            deploymentRecoveryHistory: [...state.deploymentRecoveryHistory],
            sessions: [],
            deploymentBootstrap: null,
            deploymentRecovery: null,
            bootstrap: null,
            recovery: null,
            device: null,
        };
        if (!validState(target)) throw new Error(FAILURE);
        return {
            previousDigest: snapshot?.digest ?? null,
            targetDigest: authenticationDigest(authenticationBytes(target)),
            targetState: target,
        };
    } catch {
        throw new Error(FAILURE);
    }
}

/** 排他锁由登记事务拥有；相同目标可对账，第三态绝不覆盖。 */
export function applyAuthenticationBinding(
    workspace: string,
    plan: AuthenticationBindingPlan,
): void {
    if (
        !plan ||
        (plan.previousDigest !== null &&
            (typeof plan.previousDigest !== "string" || !DIGEST.test(plan.previousDigest))) ||
        typeof plan.targetDigest !== "string" ||
        !DIGEST.test(plan.targetDigest) ||
        !validState(plan.targetState) ||
        plan.targetState.version !== 3 ||
        plan.targetState.sessions.length !== 0 ||
        [
            plan.targetState.bootstrap,
            plan.targetState.recovery,
            plan.targetState.device,
            plan.targetState.deploymentBootstrap,
            plan.targetState.deploymentRecovery,
        ].some(challenge => challenge !== null) ||
        authenticationDigest(authenticationBytes(plan.targetState)) !== plan.targetDigest
    )
        throw new Error(FAILURE);
    const file = stateFile(workspace);
    const current = readAuthenticationSnapshot(file);
    if (current?.digest === plan.targetDigest) {
        // 上次 rename 可能成功而屏障失败；同字节重新可靠发布，不能仅凭当前可读推断持久完成。
        replaceAuthenticationState(file, plan.targetDigest, plan.targetState);
        return;
    }
    if ((current?.digest ?? null) !== plan.previousDigest) throw new Error(FAILURE);
    replaceAuthenticationState(file, plan.previousDigest, plan.targetState);
}

/** 只验证登记上下文；正常配对/会话变化不会要求原目标摘要永久不变。 */
export function verifyAuthenticationBinding(
    workspace: string,
    context: AuthenticationBindingContext,
): boolean {
    if (!validAuthenticationBindingContext(context)) throw new Error(FAILURE);
    const snapshot = readAuthenticationSnapshot(stateFile(workspace));
    if (!snapshot) return false;
    let state: unknown;
    try {
        state = JSON.parse(snapshot.bytes.toString("utf8"));
    } catch {
        throw new Error(FAILURE);
    }
    if (!validState(state)) throw new Error(FAILURE);
    return state.version === 3 && sameAuthenticationBindingContext(state.bindingContext!, context);
}
