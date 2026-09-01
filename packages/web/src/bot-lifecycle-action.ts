import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { ResponseBodyTooLargeError } from "./bounded-response.js";
import { readManagementJsonResponse } from "./management-response.js";

export type BotLifecycleActionResult =
    | { success: true }
    | { success: false; code?: string; message: string };

export function buildBotLifecycleActionRequest(
    platform: string,
    uin: string,
    expectedInstanceId?: string,
): Record<string, string> {
    return {
        platform,
        uin,
        ...(expectedInstanceId ? { expected_instance_id: expectedInstanceId } : {}),
    };
}

/** 把账号运行态快照身份同时绑定到标准 header 与兼容 JSON 字段。 */
export function buildBotLifecycleActionRequestInit(
    platform: string,
    uin: string,
    identity: ManagementEvidenceIdentity,
): RequestInit {
    return {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
        },
        body: JSON.stringify(buildBotLifecycleActionRequest(platform, uin, identity.instanceId)),
        cache: "no-store",
        redirect: "error",
    };
}

/** 验证处理实例与机器回执后，再保留可信的成功或稳定错误证据。 */
export async function parseBotLifecycleActionResponse(
    response: Response,
    fallback: string,
    expectedIdentity: ManagementEvidenceIdentity,
    platform: string,
    uin: string,
): Promise<BotLifecycleActionResult> {
    let responseIdentity: ManagementEvidenceIdentity;
    try {
        responseIdentity = parseManagementEvidenceIdentity(response);
    } catch (error) {
        return {
            success: false,
            message: `${fallback}：${error instanceof Error ? error.message : "响应身份无效"}`,
        };
    }
    if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
        return {
            success: false,
            message: `${fallback}：响应实例不匹配，期望 ${expectedIdentity.instanceId}，实际 ${responseIdentity.instanceId}`,
        };
    }

    let payload: unknown;
    try {
        payload = await readManagementJsonResponse(response);
    } catch (error) {
        return {
            success: false,
            message:
                error instanceof ResponseBodyTooLargeError
                    ? `${fallback}：${error.message}`
                    : `${fallback}（HTTP ${response.status}）`,
        };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { success: false, message: `${fallback}（HTTP ${response.status}）` };
    }
    const record = payload as Record<string, unknown>;
    if (record.application !== "onebots" || record.instance_id !== expectedIdentity.instanceId) {
        return { success: false, message: `${fallback}：回执未证明处理实例` };
    }
    if (response.ok) {
        const account = record.data;
        if (
            record.success !== true ||
            !account ||
            typeof account !== "object" ||
            Array.isArray(account) ||
            (account as Record<string, unknown>).platform !== platform ||
            (account as Record<string, unknown>).uin !== uin
        ) {
            return { success: false, message: `${fallback}：成功回执与目标账号不一致` };
        }
        return { success: true };
    }
    const message =
        typeof record.message === "string" && record.message.trim()
            ? record.message.trim().replace(/\s+/gu, " ").slice(0, 500)
            : `${fallback}（HTTP ${response.status}）`;
    const code =
        typeof record.code === "string" && record.code.trim()
            ? record.code.trim().slice(0, 100)
            : undefined;
    return code ? { success: false, code, message } : { success: false, message };
}
