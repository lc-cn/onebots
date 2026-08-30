import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppCallIconVisibility,
    WhatsAppCallingSettings,
    WhatsAppFeatureStatus,
    WhatsAppPayloadEncryptionSettings,
    WhatsAppPhoneNumberSettings,
    WhatsAppSettingsUpdateResponse,
    WhatsAppSipServer,
    WhatsAppSrtpProtocol,
    WhatsAppStorageConfigurationSettings,
} from "./settings-types.js";

const FEATURE_STATUSES = new Set<WhatsAppFeatureStatus>(["enabled", "disabled"]);
const ICON_VISIBILITIES = new Set<WhatsAppCallIconVisibility>(["visible", "hidden"]);
const SRTP_PROTOCOLS = new Set<WhatsAppSrtpProtocol>(["DTLS-SRTP", "SDES-SRTP"]);

export function parsePhoneNumberSettings(value: unknown): WhatsAppPhoneNumberSettings {
    const response = record(value);
    if (!response) invalidResponse("号码设置响应必须是对象");
    return {
        calling: parseCallingSettings(response.calling),
        ...(response.payload_encryption !== undefined
            ? { payload_encryption: parsePayloadEncryption(response.payload_encryption) }
            : {}),
        storage_configuration: parseStorageConfiguration(response.storage_configuration),
    };
}

export function parseSettingsUpdateResponse(value: unknown): WhatsAppSettingsUpdateResponse {
    const response = record(value);
    if (response?.success !== true) invalidResponse("号码设置更新响应缺少 success: true");
    return { success: true };
}

function parseCallingSettings(value: unknown): WhatsAppCallingSettings {
    const calling = record(value);
    if (!calling) invalidResponse("号码设置响应缺少 calling");
    const ipAddresses = record(calling.ip_addresses);
    if (
        !featureStatus(calling.status) ||
        !iconVisibility(calling.call_icon_visibility) ||
        !featureStatus(calling.callback_permission_status) ||
        !ipAddresses ||
        !stringArray(ipAddresses.default)
    ) {
        invalidResponse("calling 设置缺少有效必填字段");
    }
    if (
        calling.srtp_key_exchange_protocol !== undefined &&
        !srtpProtocol(calling.srtp_key_exchange_protocol)
    ) {
        invalidResponse("calling.srtp_key_exchange_protocol 无效");
    }
    return {
        status: calling.status,
        call_icon_visibility: calling.call_icon_visibility,
        ip_addresses: { default: [...ipAddresses.default] },
        callback_permission_status: calling.callback_permission_status,
        ...(calling.srtp_key_exchange_protocol
            ? { srtp_key_exchange_protocol: calling.srtp_key_exchange_protocol }
            : {}),
        ...optionalCallHours(calling.call_hours),
        ...optionalCallIcons(calling.call_icons),
        ...optionalSip(calling.sip),
        ...optionalFeature(calling, "video"),
        ...optionalFeature(calling, "audio"),
        ...optionalRestrictions(calling.restrictions),
    };
}

function parsePayloadEncryption(value: unknown): WhatsAppPayloadEncryptionSettings {
    const encryption = record(value);
    if (!encryption || !featureStatus(encryption.status)) {
        invalidResponse("payload_encryption.status 无效");
    }
    return {
        status: encryption.status,
        ...optionalText(encryption, "client_encryption_key_fingerprint"),
        ...optionalText(encryption, "cloud_encryption_key"),
    };
}

function parseStorageConfiguration(value: unknown): WhatsAppStorageConfigurationSettings {
    const storage = record(value);
    if (
        !storage ||
        (storage.status !== "default" && storage.status !== "in_country_storage_enabled")
    ) {
        invalidResponse("storage_configuration.status 无效");
    }
    return {
        status: storage.status,
        ...optionalText(storage, "data_localization_region"),
    };
}

function optionalCallHours(value: unknown): { call_hours?: WhatsAppCallingSettings["call_hours"] } {
    if (value === undefined) return {};
    const settings = record(value);
    if (!settings || !featureStatus(settings.status)) invalidResponse("call_hours.status 无效");
    return {
        call_hours: {
            status: settings.status,
            ...optionalText(settings, "timezone"),
            ...optionalText(settings, "day_of_week_start"),
        },
    };
}

function optionalCallIcons(value: unknown): { call_icons?: WhatsAppCallingSettings["call_icons"] } {
    if (value === undefined) return {};
    const settings = record(value);
    if (!settings) invalidResponse("call_icons 必须是对象");
    const countries = settings.restrict_to_user_countries;
    if (countries !== undefined && !stringArray(countries)) {
        invalidResponse("call_icons.restrict_to_user_countries 必须是字符串数组");
    }
    return { call_icons: countries ? { restrict_to_user_countries: [...countries] } : {} };
}

function optionalSip(value: unknown): { sip?: WhatsAppCallingSettings["sip"] } {
    if (value === undefined) return {};
    const settings = record(value);
    if (!settings || !featureStatus(settings.status)) invalidResponse("sip.status 无效");
    if (settings.servers !== undefined && !Array.isArray(settings.servers)) {
        invalidResponse("sip.servers 必须是数组");
    }
    return {
        sip: {
            status: settings.status,
            ...(Array.isArray(settings.servers)
                ? { servers: settings.servers.map(parseSipServer) }
                : {}),
        },
    };
}

function parseSipServer(value: unknown): WhatsAppSipServer {
    const server = record(value);
    if (!server || !text(server.app_id) || !text(server.hostname)) {
        invalidResponse("SIP server 缺少 app_id 或 hostname");
    }
    if (server.port !== undefined && !integer(server.port)) invalidResponse("SIP port 必须是整数");
    return {
        app_id: server.app_id,
        hostname: server.hostname,
        ...(integer(server.port) ? { port: server.port } : {}),
        ...optionalText(server, "password"),
    };
}

function optionalFeature<TName extends "video" | "audio">(
    source: Record<string, unknown>,
    name: TName,
): Partial<Pick<WhatsAppCallingSettings, TName>> {
    if (source[name] === undefined) return {};
    const settings = record(source[name]);
    if (!settings || !featureStatus(settings.status)) invalidResponse(`${name}.status 无效`);
    return { [name]: { status: settings.status } } as Partial<Pick<WhatsAppCallingSettings, TName>>;
}

function optionalRestrictions(value: unknown): {
    restrictions?: WhatsAppCallingSettings["restrictions"];
} {
    if (value === undefined) return {};
    const settings = record(value);
    if (!settings) invalidResponse("calling.restrictions 必须是对象");
    if (settings.restrictions !== undefined && !Array.isArray(settings.restrictions)) {
        invalidResponse("calling.restrictions.restrictions 必须是数组");
    }
    return {
        restrictions: {
            ...(Array.isArray(settings.restrictions)
                ? {
                      restrictions: settings.restrictions.map(item => {
                          const restriction = record(item);
                          if (!restriction) invalidResponse("calling restriction 必须是对象");
                          if (
                              restriction.expiration !== undefined &&
                              !integer(restriction.expiration)
                          ) {
                              invalidResponse("calling restriction expiration 必须是整数");
                          }
                          return {
                              ...optionalText(restriction, "type"),
                              ...(integer(restriction.expiration)
                                  ? { expiration: restriction.expiration }
                                  : {}),
                          };
                      }),
                  }
                : {}),
        },
    };
}

function optionalText<TName extends string>(
    value: Record<string, unknown>,
    name: TName,
): Partial<Record<TName, string>> {
    const item = value[name];
    if (item === undefined) return {};
    if (!text(item)) invalidResponse(`${name} 必须是非空字符串`);
    return { [name]: item } as Partial<Record<TName, string>>;
}

function featureStatus(value: unknown): value is WhatsAppFeatureStatus {
    return typeof value === "string" && FEATURE_STATUSES.has(value as WhatsAppFeatureStatus);
}

function iconVisibility(value: unknown): value is WhatsAppCallIconVisibility {
    return typeof value === "string" && ICON_VISIBILITIES.has(value as WhatsAppCallIconVisibility);
}

function srtpProtocol(value: unknown): value is WhatsAppSrtpProtocol {
    return typeof value === "string" && SRTP_PROTOCOLS.has(value as WhatsAppSrtpProtocol);
}

function stringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(text);
}

function text(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function integer(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function invalidResponse(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_RESPONSE" });
}
