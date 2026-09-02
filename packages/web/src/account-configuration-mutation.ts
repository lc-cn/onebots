import { readManagementJsonResponse } from "./management-response.js";
import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

export type AccountConfigurationOperation = "add" | "edit" | "remove";

export type AccountConfigurationFailureCode =
    | "ACCOUNT_INSTANCE_MISMATCH"
    | "ACCOUNT_CONFIG_REVISION_MISMATCH"
    | "ACCOUNT_CONFIG_DRIFT"
    | "ACCOUNT_CONFIG_BUSY"
    | "ACCOUNT_CONFIG_INVALID"
    | "ACCOUNT_CONFIG_FAILED";

export type AccountConfigurationMutationResult =
    | { success: true; configRevision: string; message: string }
    | {
          success: false;
          code: AccountConfigurationFailureCode;
          refreshRequired: boolean;
          message: string;
      };

/** 将账号配置写入绑定到生成表单的完整实例身份与配置修订。 */
export function buildAccountConfigurationMutationRequest(
    body: unknown,
    identity: ManagementEvidenceIdentity,
    configRevision: string,
): RequestInit {
    if (!/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error("账号配置请求缺少有效配置修订号");
    }
    return {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
            [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: configRevision,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
    };
}

/** 成功必须闭合处理实例、操作目标和本次原子提交产生的新修订。 */
export async function parseAccountConfigurationMutationResponse(
    response: Response,
    expectedIdentity: ManagementEvidenceIdentity,
    operation: AccountConfigurationOperation,
    platform: string,
    accountId: string,
    fallback: string,
): Promise<AccountConfigurationMutationResult> {
    const responseIdentity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
        return {
            success: false,
            code: "ACCOUNT_INSTANCE_MISMATCH",
            refreshRequired: true,
            message: `账号配置快照已失效：期望实例 ${expectedIdentity.instanceId}，实际 ${responseIdentity.instanceId}`,
        };
    }
    const value: unknown = await readManagementJsonResponse(response);
    if (!isRecord(value) || value.application !== "onebots") {
        throw new Error("账号配置回执未声明 OneBots 应用身份");
    }
    if (value.instance_id !== expectedIdentity.instanceId) {
        throw new Error(
            `账号配置回执实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${typeof value.instance_id === "string" ? value.instance_id : "缺失"}`,
        );
    }
    if (!response.ok) {
        if (value.success !== false) throw new Error("账号配置失败回执未声明失败");
        const code = parseFailureCode(value.code);
        return {
            success: false,
            code,
            refreshRequired:
                code === "ACCOUNT_INSTANCE_MISMATCH" ||
                code === "ACCOUNT_CONFIG_REVISION_MISMATCH" ||
                code === "ACCOUNT_CONFIG_DRIFT",
            message: safeMessage(value.message, fallback),
        };
    }
    if (value.success !== true || value.operation !== operation) {
        throw new Error("账号配置成功回执与请求操作不一致");
    }
    const target = value.target;
    if (!isRecord(target) || target.platform !== platform || target.account_id !== accountId) {
        throw new Error("账号配置成功回执与目标账号不一致");
    }
    const configRevision = value.config_revision;
    const headerRevision = response.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (
        typeof configRevision !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(configRevision) ||
        headerRevision !== configRevision
    ) {
        throw new Error("账号配置成功回执缺少一致的配置修订号");
    }
    return {
        success: true,
        configRevision,
        message: safeMessage(value.message, "账号配置已保存"),
    };
}

function parseFailureCode(value: unknown): AccountConfigurationFailureCode {
    switch (value) {
        case "ACCOUNT_INSTANCE_MISMATCH":
        case "ACCOUNT_CONFIG_REVISION_MISMATCH":
        case "ACCOUNT_CONFIG_DRIFT":
        case "ACCOUNT_CONFIG_BUSY":
        case "ACCOUNT_CONFIG_INVALID":
        case "ACCOUNT_CONFIG_FAILED":
            return value;
        default:
            throw new Error("账号配置失败回执缺少有效错误码");
    }
}

function safeMessage(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim()
        ? value.trim().replace(/\s+/gu, " ").slice(0, 500)
        : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
