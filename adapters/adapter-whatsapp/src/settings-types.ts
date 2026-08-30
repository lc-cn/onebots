export type WhatsAppFeatureStatus = "enabled" | "disabled";
export type WhatsAppCallIconVisibility = "visible" | "hidden";
export type WhatsAppSrtpProtocol = "DTLS-SRTP" | "SDES-SRTP";

export interface WhatsAppCallingSettingsUpdate {
    status: WhatsAppFeatureStatus;
    call_icon_visibility?: WhatsAppCallIconVisibility;
    video?: { status: WhatsAppFeatureStatus };
    sip?: { status: WhatsAppFeatureStatus };
    srtp_key_exchange_protocol?: WhatsAppSrtpProtocol;
}

export type WhatsAppPayloadEncryptionUpdate =
    | { status: "enabled"; client_encryption_key: string }
    | { status: "disabled"; client_encryption_key?: never };

export type WhatsAppStorageConfigurationUpdate =
    | { enabled: true; region: string }
    | { enabled: false; region?: never };

export interface WhatsAppSipServer {
    app_id: string;
    hostname: string;
    port?: number;
    /** 仅 include_sip_credentials=true 且权限允许时返回。 */
    password?: string;
}

export interface WhatsAppCallingSettings {
    status: WhatsAppFeatureStatus;
    call_icon_visibility: WhatsAppCallIconVisibility;
    ip_addresses: { default: string[] };
    callback_permission_status: WhatsAppFeatureStatus;
    srtp_key_exchange_protocol?: WhatsAppSrtpProtocol;
    call_hours?: {
        status: WhatsAppFeatureStatus;
        timezone?: string;
        day_of_week_start?: string;
    };
    call_icons?: { restrict_to_user_countries?: string[] };
    sip?: { status: WhatsAppFeatureStatus; servers?: WhatsAppSipServer[] };
    video?: { status: WhatsAppFeatureStatus };
    audio?: { status: WhatsAppFeatureStatus };
    restrictions?: { restrictions?: Array<{ type?: string; expiration?: number }> };
}

export interface WhatsAppPayloadEncryptionSettings {
    status: WhatsAppFeatureStatus;
    client_encryption_key_fingerprint?: string;
    cloud_encryption_key?: string;
}

export interface WhatsAppStorageConfigurationSettings {
    status: "default" | "in_country_storage_enabled";
    data_localization_region?: string;
}

export interface WhatsAppPhoneNumberSettings {
    calling: WhatsAppCallingSettings;
    payload_encryption?: WhatsAppPayloadEncryptionSettings;
    storage_configuration: WhatsAppStorageConfigurationSettings;
}

export interface WhatsAppSettingsUpdateResponse {
    success: true;
}
