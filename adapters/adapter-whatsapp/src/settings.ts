import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import { parsePhoneNumberSettings, parseSettingsUpdateResponse } from "./settings-responses.js";
import type {
    WhatsAppCallingSettingsUpdate,
    WhatsAppPayloadEncryptionUpdate,
    WhatsAppPhoneNumberSettings,
    WhatsAppSettingsUpdateResponse,
    WhatsAppStorageConfigurationUpdate,
} from "./settings-types.js";

/** 号码级设置深模块；每次更新严格只发送一个 Meta feature setting。 */
export class WhatsAppSettings {
    constructor(private readonly client: WhatsAppClient) {}

    async get(includeSipCredentials = false): Promise<WhatsAppPhoneNumberSettings> {
        return parsePhoneNumberSettings(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/settings`,
                query: { include_sip_credentials: includeSipCredentials },
            }),
        );
    }

    async updateCalling(
        settings: WhatsAppCallingSettingsUpdate,
    ): Promise<WhatsAppSettingsUpdateResponse> {
        rejectUnknown(
            settings,
            ["status", "call_icon_visibility", "video", "sip", "srtp_key_exchange_protocol"],
            "calling",
        );
        featureStatus(settings.status, "calling.status");
        if (
            settings.call_icon_visibility !== undefined &&
            settings.call_icon_visibility !== "visible" &&
            settings.call_icon_visibility !== "hidden"
        ) {
            invalidParameter("calling.call_icon_visibility 无效");
        }
        optionalNestedStatus(settings.video, "calling.video.status");
        optionalNestedStatus(settings.sip, "calling.sip.status");
        if (
            settings.srtp_key_exchange_protocol !== undefined &&
            settings.srtp_key_exchange_protocol !== "DTLS-SRTP" &&
            settings.srtp_key_exchange_protocol !== "SDES-SRTP"
        ) {
            invalidParameter("calling.srtp_key_exchange_protocol 无效");
        }
        return this.update({
            calling: {
                status: settings.status,
                ...(settings.call_icon_visibility
                    ? { call_icon_visibility: settings.call_icon_visibility }
                    : {}),
                ...(settings.video ? { video: { status: settings.video.status } } : {}),
                ...(settings.sip ? { sip: { status: settings.sip.status } } : {}),
                ...(settings.srtp_key_exchange_protocol
                    ? { srtp_key_exchange_protocol: settings.srtp_key_exchange_protocol }
                    : {}),
            },
        });
    }

    async updateUserIdentityChange(enabled: boolean): Promise<WhatsAppSettingsUpdateResponse> {
        if (typeof enabled !== "boolean")
            invalidParameter("user_identity_change.enabled 必须是布尔值");
        return this.update({ user_identity_change: { enabled } });
    }

    async updatePayloadEncryption(
        settings: WhatsAppPayloadEncryptionUpdate,
    ): Promise<WhatsAppSettingsUpdateResponse> {
        rejectUnknown(settings, ["status", "client_encryption_key"], "payload_encryption");
        featureStatus(settings.status, "payload_encryption.status");
        if (settings.status === "enabled") {
            requireText(settings.client_encryption_key, "client_encryption_key");
        } else if ("client_encryption_key" in settings) {
            invalidParameter("关闭 payload encryption 时不能发送 client_encryption_key");
        }
        return this.update({
            payload_encryption:
                settings.status === "enabled"
                    ? {
                          status: "enabled",
                          client_encryption_key: settings.client_encryption_key,
                      }
                    : { status: "disabled" },
        });
    }

    async updateStorage(
        settings: WhatsAppStorageConfigurationUpdate,
    ): Promise<WhatsAppSettingsUpdateResponse> {
        rejectUnknown(settings, ["enabled", "region"], "storage_configuration");
        if (typeof settings.enabled !== "boolean") {
            invalidParameter("storage_configuration.enabled 必须是布尔值");
        }
        if (settings.enabled) requireText(settings.region, "storage_configuration.region");
        if (!settings.enabled && "region" in settings) {
            invalidParameter("关闭自定义存储时不能发送 region");
        }
        return this.update({
            storage_configuration: settings.enabled
                ? { enabled: true, region: settings.region }
                : { enabled: false },
        });
    }

    private async update(
        body: Readonly<Record<string, unknown>>,
    ): Promise<WhatsAppSettingsUpdateResponse> {
        return parseSettingsUpdateResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/settings`,
                body,
            }),
        );
    }
}

type SettingsActionParams = Readonly<Record<string, unknown>>;

const SETTINGS_ACTION_HANDLERS = {
    get_phone_number_settings: (client: WhatsAppClient, params: SettingsActionParams) =>
        client.settings.get(optionalBoolean(params, "include_sip_credentials") || false),
    update_calling_settings: (client: WhatsAppClient, params: SettingsActionParams) =>
        client.settings.updateCalling(callingUpdateParam(params)),
    update_user_identity_change_settings: (client: WhatsAppClient, params: SettingsActionParams) =>
        client.settings.updateUserIdentityChange(booleanParam(params, "enabled")),
    update_payload_encryption_settings: (client: WhatsAppClient, params: SettingsActionParams) =>
        client.settings.updatePayloadEncryption(encryptionUpdateParam(params)),
    update_storage_configuration_settings: (client: WhatsAppClient, params: SettingsActionParams) =>
        client.settings.updateStorage(storageUpdateParam(params)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Phone Number Settings 动作的执行与参数契约单一来源。 */
export const WHATSAPP_SETTINGS_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    SETTINGS_ACTION_HANDLERS,
    {
        get_phone_number_settings: ["include_sip_credentials"],
        update_calling_settings: ["calling"],
        update_user_identity_change_settings: ["enabled"],
        update_payload_encryption_settings: ["payload_encryption"],
        update_storage_configuration_settings: ["storage_configuration"],
    },
);

export type WhatsAppSettingsAction = keyof typeof WHATSAPP_SETTINGS_ACTION_HANDLERS;

export function isWhatsAppSettingsAction(action: string): action is WhatsAppSettingsAction {
    return Object.hasOwn(WHATSAPP_SETTINGS_ACTION_HANDLERS, action);
}

function featureStatus(value: unknown, name: string): asserts value is "enabled" | "disabled" {
    if (value !== "enabled" && value !== "disabled") invalidParameter(`${name} 无效`);
}

function optionalNestedStatus(value: unknown, name: string): void {
    if (value === undefined) return;
    const settings = asRecord(value);
    if (!settings) invalidParameter(`${name} 所在设置必须是对象`);
    rejectUnknown(settings, ["status"], name.replace(/\.status$/u, ""));
    featureStatus(settings.status, name);
}

function recordParam(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = asRecord(params[name]);
    if (!value) invalidParameter(`${name} 必须是对象`);
    return value;
}

function callingUpdateParam(
    params: Readonly<Record<string, unknown>>,
): WhatsAppCallingSettingsUpdate {
    const value = recordParam(params, "calling");
    rejectUnknown(
        value,
        ["status", "call_icon_visibility", "video", "sip", "srtp_key_exchange_protocol"],
        "calling",
    );
    const status = value.status;
    featureStatus(status, "calling.status");
    const visibility = value.call_icon_visibility;
    if (visibility !== undefined && visibility !== "visible" && visibility !== "hidden") {
        invalidParameter("calling.call_icon_visibility 无效");
    }
    const protocol = value.srtp_key_exchange_protocol;
    if (protocol !== undefined && protocol !== "DTLS-SRTP" && protocol !== "SDES-SRTP") {
        invalidParameter("calling.srtp_key_exchange_protocol 无效");
    }
    const video = nestedStatus(value.video, "calling.video");
    const sip = nestedStatus(value.sip, "calling.sip");
    return {
        status,
        ...(visibility ? { call_icon_visibility: visibility } : {}),
        ...(video ? { video } : {}),
        ...(sip ? { sip } : {}),
        ...(protocol ? { srtp_key_exchange_protocol: protocol } : {}),
    };
}

function encryptionUpdateParam(
    params: Readonly<Record<string, unknown>>,
): WhatsAppPayloadEncryptionUpdate {
    const value = recordParam(params, "payload_encryption");
    rejectUnknown(value, ["status", "client_encryption_key"], "payload_encryption");
    if (value.status === "enabled") {
        requireText(value.client_encryption_key, "client_encryption_key");
        return { status: "enabled", client_encryption_key: value.client_encryption_key };
    }
    if (value.status === "disabled") {
        if (value.client_encryption_key !== undefined) {
            invalidParameter("关闭 payload encryption 时不能发送 client_encryption_key");
        }
        return { status: "disabled" };
    }
    invalidParameter("payload_encryption.status 无效");
}

function storageUpdateParam(
    params: Readonly<Record<string, unknown>>,
): WhatsAppStorageConfigurationUpdate {
    const value = recordParam(params, "storage_configuration");
    rejectUnknown(value, ["enabled", "region"], "storage_configuration");
    if (value.enabled === true) {
        requireText(value.region, "storage_configuration.region");
        return { enabled: true, region: value.region };
    }
    if (value.enabled === false) {
        if (value.region !== undefined) invalidParameter("关闭自定义存储时不能发送 region");
        return { enabled: false };
    }
    invalidParameter("storage_configuration.enabled 必须是布尔值");
}

function nestedStatus(
    value: unknown,
    name: string,
): { status: "enabled" | "disabled" } | undefined {
    if (value === undefined) return undefined;
    const settings = asRecord(value);
    if (!settings) invalidParameter(`${name} 必须是对象`);
    rejectUnknown(settings, ["status"], name);
    featureStatus(settings.status, `${name}.status`);
    return { status: settings.status };
}

function booleanParam(params: Readonly<Record<string, unknown>>, name: string): boolean {
    const value = params[name];
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function rejectUnknown(value: unknown, allowed: readonly string[], name: string): void {
    const source = asRecord(value);
    if (!source) invalidParameter(`${name} 必须是对象`);
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`${name} 包含未知字段: ${unknown}`);
}

function requireText(value: unknown, name: string): asserts value is string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 不能为空`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
