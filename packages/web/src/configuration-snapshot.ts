import {
    MANAGEMENT_CONFIG_REVISION_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

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

export interface ConfigurationMutationResult {
    success: boolean;
    application?: unknown;
    instance_id?: unknown;
    config_revision?: unknown;
    message?: unknown;
    restartRequired?: unknown;
}

/** 保存成功必须由处理请求的同一实例明确确认。 */
export function assertConfigurationMutationAcknowledgement(
    response: Pick<Response, "headers">,
    payload: ConfigurationMutationResult,
    expectedIdentity: ManagementEvidenceIdentity,
): string {
    assertConfigurationMutationIdentity(response, payload, expectedIdentity);
    if (payload.success !== true) throw new Error("配置保存回执未声明成功");
    const headerRevision =
        response.headers.get(MANAGEMENT_CONFIG_REVISION_HEADER)?.trim() ?? "";
    if (
        typeof payload.config_revision !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(payload.config_revision) ||
        headerRevision !== payload.config_revision
    ) {
        throw new Error("配置保存回执缺少一致的配置修订号");
    }
    return payload.config_revision;
}

/** 失败诊断也必须来自处理该快照的同一实例，避免展示代理拼接的正文。 */
export function configurationMutationFailureMessage(
    response: Pick<Response, "headers">,
    payload: ConfigurationMutationResult,
    expectedIdentity: ManagementEvidenceIdentity,
): string {
    assertConfigurationMutationIdentity(response, payload, expectedIdentity);
    if (payload.success !== false) throw new Error("配置保存失败回执未声明失败");
    return typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim().replace(/\s+/gu, " ").slice(0, 500)
        : "保存失败";
}

function assertConfigurationMutationIdentity(
    response: Pick<Response, "headers">,
    payload: ConfigurationMutationResult,
    expectedIdentity: ManagementEvidenceIdentity,
): void {
    const responseIdentity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(responseIdentity, expectedIdentity)) {
        throw new Error(
            `配置保存响应实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${responseIdentity.instanceId}`,
        );
    }
    if (payload.application !== "onebots" || payload.instance_id !== expectedIdentity.instanceId) {
        throw new Error(
            `配置保存回执实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${typeof payload.instance_id === "string" ? payload.instance_id : "缺失"}`,
        );
    }
}
