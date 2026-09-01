import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { DEFAULT_SERVICE_PROBE_TIMEOUT_MS } from "./utils/service-probe-request.js";
import { probeHealth, type ServiceProbeIdentity } from "./utils/service-probes.js";

export type AuthenticationTargetResult =
    | { ok: true; identity: ServiceProbeIdentity }
    | { ok: false; message: string };

/** 在浏览器发送任何管理凭据前，先用公开健康端点证明目标是 OneBots。 */
export async function verifyAuthenticationTarget(
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal | null,
): Promise<AuthenticationTargetResult> {
    const health = await probeHealth(fetcher, DEFAULT_SERVICE_PROBE_TIMEOUT_MS, signal);
    if (health.state !== "success" || !health.identity) {
        return {
            ok: false,
            message: `拒绝发送管理凭据：${health.detail}`,
        };
    }
    return { ok: true, identity: health.identity };
}

export function authenticationExchangeHeaders(
    identity: ServiceProbeIdentity,
    headers?: HeadersInit,
): Headers {
    const result = new Headers(headers);
    result.set(MANAGEMENT_EXPECTED_INSTANCE_HEADER, identity.instanceId);
    return result;
}

/** 登录或刷新回执必须继续来自预检通过的同一运行实例。 */
export function assertAuthenticationResponseIdentity(
    response: Pick<Response, "headers">,
    expected: ServiceProbeIdentity,
): ManagementEvidenceIdentity {
    let actual: ManagementEvidenceIdentity;
    try {
        actual = parseManagementEvidenceIdentity(response);
    } catch (error) {
        throw new AuthenticationResponseIdentityError("认证响应缺少完整 OneBots 实例身份", error);
    }
    if (!sameManagementEvidenceIdentity(actual, expected)) {
        throw new AuthenticationResponseIdentityError(
            `认证响应实例不匹配：期望 ${expected.instanceId}，实际 ${actual.instanceId}`,
        );
    }
    return actual;
}

export class AuthenticationResponseIdentityError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
        this.name = "AuthenticationResponseIdentityError";
    }
}
