import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { readManagementJsonResponse } from "./management-response.js";

export interface ConfigurationSnapshot<TSchema> {
    identity: ManagementEvidenceIdentity;
    configRevision: string;
    content: string;
    schema: TSchema;
}

/** 原子采用配置正文与 Schema，拒绝代理跨实例拼接两份管理证据。 */
export function parseConfigurationSnapshot<TSchema>(
    configResponse: Pick<Response, "headers">,
    schemaResponse: Pick<Response, "headers">,
    content: unknown,
    schema: TSchema,
): ConfigurationSnapshot<TSchema> {
    const configIdentity = parseManagementEvidenceIdentity(configResponse);
    const schemaIdentity = parseManagementEvidenceIdentity(schemaResponse);
    if (!sameManagementEvidenceIdentity(configIdentity, schemaIdentity)) {
        throw new Error("配置正文与 Schema 来自不同的 OneBots 实例");
    }
    const configRevision =
        configResponse.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (!/^sha256:[a-f0-9]{64}$/u.test(configRevision)) {
        throw new Error("配置正文缺少有效修订号");
    }
    if (typeof content !== "string") throw new Error("配置正文必须是文本");
    return { identity: configIdentity, configRevision, content, schema };
}

export type ConfigurationMutationFailureCode =
    | "CONFIG_INSTANCE_MISMATCH"
    | "CONFIG_REVISION_MISMATCH"
    | "CONFIG_DRIFT"
    | "CONFIG_BUSY"
    | "CONFIG_INVALID"
    | "CONFIG_APPLY_FAILED";

export type ConfigurationMutationResult =
    | {
          success: true;
          configRevision: string;
          applied: boolean;
          restartRequired: boolean;
          changedHostFields: string[];
          message: string;
      }
    | {
          success: false;
          code: ConfigurationMutationFailureCode;
          refreshRequired: boolean;
          message: string;
      };

/** 在读取正文前先闭合响应实例，再验证保存操作、应用状态与配置提交。 */
export async function parseConfigurationMutationResponse(
    response: Response,
    expectedIdentity: ManagementEvidenceIdentity,
): Promise<ConfigurationMutationResult> {
    const responseIdentity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
        return {
            success: false,
            code: "CONFIG_INSTANCE_MISMATCH",
            refreshRequired: true,
            message: `配置快照已失效：期望实例 ${expectedIdentity.instanceId}，实际 ${responseIdentity.instanceId}`,
        };
    }
    const payload: unknown = await readManagementJsonResponse(response);
    if (!isRecord(payload) || payload.application !== "onebots") {
        throw new Error("配置保存回执未声明 OneBots 应用身份");
    }
    if (payload.instance_id !== expectedIdentity.instanceId) {
        throw new Error(
            `配置保存回执实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${typeof payload.instance_id === "string" ? payload.instance_id : "缺失"}`,
        );
    }
    if (!response.ok) {
        if (payload.success !== false) throw new Error("配置保存失败回执未声明失败");
        const code = parseConfigurationMutationFailureCode(payload.code);
        return {
            success: false,
            code,
            refreshRequired:
                code === "CONFIG_INSTANCE_MISMATCH" ||
                code === "CONFIG_REVISION_MISMATCH" ||
                code === "CONFIG_DRIFT",
            message: safeConfigurationMessage(payload.message, "保存失败"),
        };
    }
    if (payload.success !== true || payload.operation !== "save") {
        throw new Error("配置保存成功回执与请求操作不一致");
    }
    const headerRevision = response.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (
        typeof payload.config_revision !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(payload.config_revision) ||
        headerRevision !== payload.config_revision
    ) {
        throw new Error("配置保存回执缺少一致的配置修订号");
    }
    const changedHostFields = parseChangedHostFields(payload.changedHostFields);
    if (payload.restartRequired === true) {
        if (payload.applied !== false || changedHostFields.length === 0) {
            throw new Error("配置保存回执的重启状态无效");
        }
    } else if (
        payload.restartRequired !== false ||
        payload.applied !== true ||
        changedHostFields.length !== 0
    ) {
        throw new Error("配置保存回执的应用状态无效");
    }
    return {
        success: true,
        configRevision: payload.config_revision,
        applied: payload.applied,
        restartRequired: payload.restartRequired,
        changedHostFields,
        message: safeConfigurationMessage(payload.message, "配置已保存"),
    };
}

function parseConfigurationMutationFailureCode(value: unknown): ConfigurationMutationFailureCode {
    switch (value) {
        case "CONFIG_INSTANCE_MISMATCH":
        case "CONFIG_REVISION_MISMATCH":
        case "CONFIG_DRIFT":
        case "CONFIG_BUSY":
        case "CONFIG_INVALID":
        case "CONFIG_APPLY_FAILED":
            return value;
        default:
            throw new Error("配置保存失败回执缺少有效错误码");
    }
}

function parseChangedHostFields(value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        value.some(
            field =>
                typeof field !== "string" ||
                !field.trim() ||
                field.length > 100 ||
                /[\u0000-\u001f\u007f]/u.test(field),
        )
    ) {
        throw new Error("配置保存回执的宿主字段无效");
    }
    const fields = value.map(field => field.trim());
    if (new Set(fields).size !== fields.length) {
        throw new Error("配置保存回执的宿主字段重复");
    }
    return fields;
}

function safeConfigurationMessage(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim()
        ? value.trim().replace(/\s+/gu, " ").slice(0, 500)
        : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
