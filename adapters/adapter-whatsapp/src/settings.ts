import type { PlatformActionHandler } from "onebots";
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

export const WHATSAPP_SETTINGS_ACTIONS = Object.freeze([
    "get_phone_number_settings",
    "update_calling_settings",
    "update_user_identity_change_settings",
    "update_payload_encryption_settings",
    "update_storage_configuration_settings",
] as const);

export type WhatsAppSettingsAction = (typeof WHATSAPP_SETTINGS_ACTIONS)[number];

export function isWhatsAppSettingsAction(action: string): action is WhatsAppSettingsAction {
    return (WHATSAPP_SETTINGS_ACTIONS as readonly string[]).includes(action);
}

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

    execute(
        action: WhatsAppSettingsAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "get_phone_number_settings":
                return this.get(optionalBoolean(params, "include_sip_credentials") || false);
            case "update_calling_settings":
                return this.updateCalling(callingUpdateParam(params));
            case "update_user_identity_change_settings":
                return this.updateUserIdentityChange(booleanParam(params, "enabled"));
            case "update_payload_encryption_settings":
                return this.updatePayloadEncryption(encryptionUpdateParam(params));
            case "update_storage_configuration_settings":
                return this.updateStorage(storageUpdateParam(params));
        }
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

export const WHATSAPP_SETTINGS_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_SETTINGS_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.settings.execute(action, params),
    ]),
) as Record<WhatsAppSettingsAction, PlatformActionHandler<WhatsAppClient>>;

function featureStatus(value: unknown, name: string): asserts value is "enabled" | "disabled" {
    if (value !== "enabled" && value !== "disabled") invalidParameter(`${name} 无效`);
}

function optionalNestedStatus(value: unknown, name: string): void {
    if (value === undefined) return;
    const settings = asRecord(value);
    if (!settings) invalidParameter(`${name} 所在设置必须是对象`);
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
