import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "../management-evidence-identity.js";
import { readManagementJsonResponse } from "../management-response.js";

export type ExtensionMutationOperation = "install" | "disable" | "uninstall";

export type ExtensionMutationFailureCode =
    | "EXTENSION_INSTANCE_MISMATCH"
    | "EXTENSION_CONFIG_REVISION_MISMATCH"
    | "EXTENSION_BUSY"
    | "EXTENSION_STATE_CONFLICT"
    | "EXTENSION_NOT_FOUND"
    | "EXTENSION_RUNTIME_CONFIG_INVALID"
    | "EXTENSION_CATALOG_UNAVAILABLE"
    | "EXTENSION_INVALID"
    | "EXTENSION_FAILED";

export type ExtensionMutationResult =
    | {
          success: true;
          configRevision: string;
          restartRequired: boolean;
          restartSupported: boolean;
          message: string;
      }
    | {
          success: false;
          code: ExtensionMutationFailureCode;
          refreshRequired: boolean;
          message: string;
      };

/** 将扩展变更绑定到生成目录的实例和配置内容。 */
export function buildExtensionInstallRequestHeaders(
    identity: ManagementEvidenceIdentity,
    configRevision: string,
    operation = "安装",
): Record<string, string> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error(`扩展${operation}请求缺少有效配置修订号`);
    }
    return {
        [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
        [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: configRevision,
    };
}

/** 只消费同一实例的扩展变更正文，并闭合操作、目标与提交后的配置修订。 */
export async function parseExtensionMutationResponse(
    response: Response,
    expectedIdentity: ManagementEvidenceIdentity,
    operation: ExtensionMutationOperation,
    targetId: string,
    fallback: string,
): Promise<ExtensionMutationResult> {
    const identity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(identity, expectedIdentity)) {
        return {
            success: false,
            code: "EXTENSION_INSTANCE_MISMATCH",
            refreshRequired: true,
            message: `扩展管理快照已失效：期望实例 ${expectedIdentity.instanceId}，实际 ${identity.instanceId}`,
        };
    }
    const value: unknown = await readManagementJsonResponse(response);
    if (
        !isRecord(value) ||
        value.application !== "onebots" ||
        value.instance_id !== expectedIdentity.instanceId
    ) {
        throw new Error("扩展变更回执未由预期 OneBots 实例确认");
    }
    if (!response.ok) {
        if (value.success !== false) throw new Error("扩展变更失败回执未声明失败");
        const code = parseFailureCode(value.code);
        return {
            success: false,
            code,
            refreshRequired:
                code === "EXTENSION_INSTANCE_MISMATCH" ||
                code === "EXTENSION_CONFIG_REVISION_MISMATCH",
            message: safeMessage(value.message, fallback),
        };
    }
    if (
        value.success !== true ||
        value.operation !== operation ||
        !isRecord(value.target) ||
        value.target.id !== targetId
    ) {
        throw new Error("扩展变更成功回执与请求操作或目标不一致");
    }
    const configRevision = value.config_revision;
    const headerRevision = response.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (
        typeof configRevision !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(configRevision) ||
        headerRevision !== configRevision
    ) {
        throw new Error("扩展变更成功回执缺少一致的配置修订号");
    }
    if (
        typeof value.restartRequired !== "boolean" ||
        typeof value.restartSupported !== "boolean" ||
        typeof value.message !== "string" ||
        !value.message.trim()
    ) {
        throw new Error("扩展变更成功回执缺少完整完成状态");
    }
    return {
        success: true,
        configRevision,
        restartRequired: value.restartRequired,
        restartSupported: value.restartSupported,
        message: safeMessage(value.message, fallback),
    };
}

function parseFailureCode(value: unknown): ExtensionMutationFailureCode {
    switch (value) {
        case "EXTENSION_INSTANCE_MISMATCH":
        case "EXTENSION_CONFIG_REVISION_MISMATCH":
        case "EXTENSION_BUSY":
        case "EXTENSION_STATE_CONFLICT":
        case "EXTENSION_NOT_FOUND":
        case "EXTENSION_RUNTIME_CONFIG_INVALID":
        case "EXTENSION_CATALOG_UNAVAILABLE":
        case "EXTENSION_INVALID":
        case "EXTENSION_FAILED":
            return value;
        default:
            throw new Error("扩展变更失败回执缺少有效错误码");
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
