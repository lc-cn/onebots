import { AdapterRegistry, type Schema } from "onebots";

export { WhatsAppAdapter } from "./adapter.js";
export {
    isWhatsAppBusinessComplianceAction,
    WhatsAppBusinessCompliance,
    WHATSAPP_BUSINESS_COMPLIANCE_ACTIONS,
    WHATSAPP_BUSINESS_COMPLIANCE_FIELDS,
    WHATSAPP_BUSINESS_ENTITY_TYPES,
    type WhatsAppBusinessComplianceAction,
    type WhatsAppBusinessComplianceField,
    type WhatsAppBusinessComplianceInfo,
    type WhatsAppBusinessComplianceResponse,
    type WhatsAppBusinessComplianceUpdate,
    type WhatsAppBusinessComplianceUpdateResponse,
    type WhatsAppBusinessEntityType,
    type WhatsAppComplianceContactDetails,
    type WhatsAppComplianceContactInfo,
    type WhatsAppGrievanceOfficerDetails,
    type WhatsAppGrievanceOfficerInfo,
} from "./business-compliance.js";
export {
    isWhatsAppBusinessEncryptionAction,
    WhatsAppBusinessEncryption,
    WHATSAPP_BUSINESS_ENCRYPTION_ACTIONS,
    type WhatsAppBusinessEncryptionAction,
    type WhatsAppBusinessEncryptionInfo,
    type WhatsAppBusinessEncryptionResponse,
    type WhatsAppBusinessEncryptionUpdateResponse,
    type WhatsAppBusinessPublicKeySignatureStatus,
} from "./business-encryption.js";
export {
    isWhatsAppBusinessProfileAction,
    WhatsAppBusinessProfiles,
    WHATSAPP_BUSINESS_PROFILE_ACTIONS,
    WHATSAPP_BUSINESS_PROFILE_FIELDS,
    WHATSAPP_BUSINESS_VERTICALS,
    type WhatsAppBusinessProfile,
    type WhatsAppBusinessProfileAction,
    type WhatsAppBusinessProfileField,
    type WhatsAppBusinessProfileResponse,
    type WhatsAppBusinessProfileUpdate,
    type WhatsAppBusinessProfileUpdateResponse,
    type WhatsAppBusinessVertical,
} from "./business-profile.js";
export { whatsAppCapabilities } from "./capabilities.js";
export { WhatsAppClient } from "./client.js";
export {
    isWhatsAppSolutionMigrationAction,
    WhatsAppSolutionMigration,
    WHATSAPP_MIGRATION_INTENT_FIELDS,
    WHATSAPP_MIGRATION_STATUSES,
    WHATSAPP_SOLUTION_MIGRATION_ACTIONS,
    WHATSAPP_SOLUTION_MIGRATION_INTENTS,
    WHATSAPP_SOLUTION_MIGRATION_REQUEST_STATUSES,
    type WhatsAppMigrationIntent,
    type WhatsAppMigrationIntentField,
    type WhatsAppMigrationStatus,
    type WhatsAppSolutionMigrationAction,
    type WhatsAppSolutionMigrationIntent,
    type WhatsAppSolutionMigrationRequest,
    type WhatsAppSolutionMigrationRequestStatus,
    type WhatsAppSolutionMigrationResponse,
} from "./solution-migration.js";
export {
    isWhatsAppCallingAction,
    WhatsAppCalling,
    WHATSAPP_CALLING_ACTIONS,
    type WhatsAppCallingAction,
} from "./calling.js";
export { WhatsAppApiError, type WhatsAppApiErrorOptions } from "./errors.js";
export {
    isWhatsAppEncryptedMessageAction,
    WhatsAppEncryptedMessages,
    WHATSAPP_ENCRYPTED_MESSAGE_ACTIONS,
    type WhatsAppEncryptedMessageAction,
    type WhatsAppEncryptedMessageResponse,
} from "./encrypted-messages.js";
export {
    isWhatsAppPhoneNumberAction,
    WhatsAppPhoneNumbers,
    WHATSAPP_PHONE_NUMBER_ACTIONS,
    type WhatsAppPhoneNumberAction,
    type WhatsAppPhoneNumberRegistration,
    type WhatsAppSuccessResponse,
    type WhatsAppVerificationCodeMethod,
    type WhatsAppVerificationCodeRequest,
    type WhatsAppVerificationCodeResponse,
} from "./phone-numbers.js";
export {
    isWhatsAppHistoryAction,
    WhatsAppHistory,
    WHATSAPP_HISTORY_ACTIONS,
    type WhatsAppHistoryAction,
} from "./history.js";
export { projectMessageContent, projectWhatsAppWebhook } from "./events.js";
export {
    isWhatsAppSettingsAction,
    WhatsAppSettings,
    WHATSAPP_SETTINGS_ACTIONS,
    type WhatsAppSettingsAction,
} from "./settings.js";
export { isWhatsAppGroupWebhookEntry } from "./group-webhook.js";
export { compileWhatsAppMessages } from "./messages.js";
export {
    isWhatsAppGroupAction,
    WhatsAppGroups,
    WHATSAPP_GROUP_ACTIONS,
    type WhatsAppGroupAction,
} from "./groups.js";
export {
    executeWhatsAppPlatformAction,
    WHATSAPP_PLATFORM_ACTIONS,
    type WhatsAppPlatformAction,
} from "./platform-actions.js";
export { WhatsAppWebhookHost } from "./webhook-host.js";
export {
    routeWhatsAppWebhook,
    WhatsAppWebhookRouter,
    type WhatsAppWebhookDelivery,
} from "./webhook-routing.js";
export type { WhatsAppHttpContext } from "./webhook-host.js";
export type {
    WhatsAppCallIconVisibility,
    WhatsAppCallingSettings,
    WhatsAppCallingSettingsUpdate,
    WhatsAppFeatureStatus,
    WhatsAppPayloadEncryptionSettings,
    WhatsAppPayloadEncryptionUpdate,
    WhatsAppPhoneNumberSettings,
    WhatsAppSettingsUpdateResponse,
    WhatsAppSipServer,
    WhatsAppSrtpProtocol,
    WhatsAppStorageConfigurationSettings,
    WhatsAppStorageConfigurationUpdate,
} from "./settings-types.js";
export type {
    WhatsAppHistoryDeliveryStatus,
    WhatsAppHistoryEvent,
    WhatsAppHistoryEventEdge,
    WhatsAppHistoryEventOccurrence,
    WhatsAppHistoryEventsQuery,
    WhatsAppHistoryEventsResponse,
    WhatsAppHistoryPaging,
    WhatsAppMessageHistoryEntry,
    WhatsAppMessageHistoryQuery,
    WhatsAppMessageHistoryResponse,
    WhatsAppWebhookUpdateState,
} from "./history-types.js";
export type {
    WhatsAppCallConnectParams,
    WhatsAppCallManageParams,
    WhatsAppCallPermissionAction,
    WhatsAppCallPermissionActionName,
    WhatsAppCallPermissionLimit,
    WhatsAppCallPermissionResponse,
    WhatsAppCallPermissionStatus,
    WhatsAppCallResponse,
    WhatsAppCallSession,
    WhatsAppCallTerminateResponse,
} from "./calling-types.js";
export type {
    WhatsAppAPIResponse,
    WhatsAppCallOptions,
    WhatsAppClientEvents,
    WhatsAppConfig,
    WhatsAppContact,
    WhatsAppErrorData,
    WhatsAppGroupCreateParams,
    WhatsAppGroupDetails,
    WhatsAppGroupIdentityFields,
    WhatsAppGroupInviteLinkDeletedResponse,
    WhatsAppGroupInviteLinkResponse,
    WhatsAppGroupJoinRequest,
    WhatsAppGroupJoinRequestActionResponse,
    WhatsAppGroupJoinRequestCreatedEntry,
    WhatsAppGroupJoinRequestRevokedEntry,
    WhatsAppGroupJoinRequestsResponse,
    WhatsAppGroupLifecycleEntry,
    WhatsAppGroupListResponse,
    WhatsAppGroupOperationResponse,
    WhatsAppGroupPagination,
    WhatsAppGroupParticipant,
    WhatsAppGroupParticipantsAddedEntry,
    WhatsAppGroupParticipantsEntry,
    WhatsAppGroupParticipantsRemovedEntry,
    WhatsAppGroupSettingResult,
    WhatsAppGroupSettingsEntry,
    WhatsAppGroupStatusEntry,
    WhatsAppGroupSuccessResponse,
    WhatsAppGroupSummary,
    WhatsAppGroupUpdateParams,
    WhatsAppGroupWebhookEntry,
    WhatsAppGroupWebhookError,
    WhatsAppMediaInfo,
    WhatsAppMediaObject,
    WhatsAppIngestResult,
    WhatsAppMessageEvent,
    WhatsAppMessageStatus,
    WhatsAppMessageStatusEvent,
    WhatsAppMessageType,
    WhatsAppObservedContact,
    WhatsAppPaging,
    WhatsAppPhoneNumberInfo,
    WhatsAppSendMessageParams,
    WhatsAppWebhookChange,
    WhatsAppWebhookContact,
    WhatsAppWebhookEvent,
    WhatsAppWebhookMetadata,
    WhatsAppWebhookRequest,
    WhatsAppWebhookResponse,
    WhatsAppWebhookValue,
    WhatsAppVerifiedWebhook,
} from "./types.js";

export const whatsappSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 WhatsApp 号码的稳定标识",
        ui: { section: "credentials" },
    },
    phone_number_id: {
        type: "string",
        required: true,
        label: "Phone Number ID",
        description: "WhatsApp > API Setup 中的 Phone Number ID",
        ui: { section: "credentials" },
    },
    business_account_id: {
        type: "string",
        required: true,
        label: "Business Account ID",
        description: "WhatsApp Business Account ID，用于模板等管理 API",
        ui: { section: "credentials" },
    },
    access_token: {
        type: "string",
        required: true,
        label: "Access Token",
        sensitive: true,
        description: "建议使用系统用户生成的长期访问令牌",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        label: "App Secret",
        sensitive: true,
        description: "使用 ingestHttp()/acceptHttp() 时用于校验 X-Hub-Signature-256",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook", "manual"] },
        },
    },
    receive_mode: {
        type: "string",
        default: "webhook",
        label: "事件接收方式",
        choices: [
            { value: "webhook", label: "Webhook" },
            { value: "manual", label: "手动接入既有 Host/队列" },
        ],
        description: "manual 不注册路由，由现有 Host 调用 ingest()/ingestHttp()/acceptHttp()",
        ui: { section: "transport" },
    },
    webhook_verify_token: {
        type: "string",
        label: "Webhook Verify Token",
        sensitive: true,
        description: "acceptHttp() 处理 Meta GET 验证时使用，须与控制台配置一致",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook", "manual"] },
        },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/whatsapp/{account_id}/webhook",
        description: "复用 OneBots 主 HTTP 服务；留空自动生成账号隔离路径",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    api_version: {
        type: "string",
        required: true,
        label: "Graph API 版本",
        description: "按 Meta 应用当前已启用的版本填写，例如 v23.0，避免隐式版本漂移",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://graph.facebook.com",
        label: "Graph API Base URL",
        description: "仅官方兼容代理或测试环境需要覆盖，必须使用 HTTPS",
        pattern: /^https:\/\/[^\s/?#]+(?::\d+)?\/?$/,
        ui: { section: "advanced" },
    },
    deduplicate_webhooks: {
        type: "boolean",
        default: true,
        label: "过滤重复 Webhook",
        description: "按原始负载哈希过滤 Meta 重投递",
        ui: { section: "delivery" },
    },
    webhook_deduplication_limit: {
        type: "number",
        default: 10000,
        label: "去重缓存上限",
        description: "进程内保留的最近 Webhook 哈希数量，最低 100",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("whatsapp", whatsappSchema);
