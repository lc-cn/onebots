import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { TEAMS_PLATFORM_ACTIONS } from "./platform-actions.js";

const contextual = {
    support: "native" as const,
    availability: "context" as const,
    note: "需要已持久化的真实 Teams ConversationReference",
};

const platformActions = Object.fromEntries(
    [...TEAMS_PLATFORM_ACTIONS].map(action => [action, contextual]),
);

/** Teams 能力以 Microsoft 365 Agents SDK 与 Connector API 的真实实现为准。 */
export const teamsCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { ...contextual, scenes: ["private", "direct", "group", "channel"] },
        update_message: contextual,
        delete_message: contextual,
        get_group_list: { support: "native", note: "仅列出 groupChat，不混入团队频道" },
        get_group_info: contextual,
        get_group_member_list: contextual,
        get_group_member_info: contextual,
        get_login_info: { support: "native" },
        get_status: { support: "native" },
        get_version: { support: "native" },
        get_supported_actions: { support: "native" },
        get_conversation_reference: contextual,
        list_conversation_references: { support: "native" },
        register_conversation_reference: { support: "native" },
        create_personal_conversation: {
            support: "native",
            availability: "permission",
            permissions: ["Teams app installed for target user"],
        },
        send_adaptive_card: contextual,
        send_targeted_message: { ...contextual, scenes: ["group", "channel"] },
        reply_to_activity: contextual,
        create_targeted_activity: { ...contextual, scenes: ["group", "channel"] },
        update_targeted_activity: { ...contextual, scenes: ["group", "channel"] },
        delete_targeted_activity: { ...contextual, scenes: ["group", "channel"] },
        send_typing: contextual,
        send_file_consent_card: contextual,
        send_file_info_card: contextual,
        complete_file_consent_upload: {
            ...contextual,
            note: "上传到 consent invoke 返回的 OneDrive URL，并发送标准 file-info 卡片",
        },
        get_team_details: contextual,
        list_team_channels: contextual,
        get_conversation_member: contextual,
        list_conversation_members: contextual,
        list_conversation_members_paged: contextual,
        get_activity_members: contextual,
        add_message_reaction: contextual,
        remove_message_reaction: contextual,
        get_meeting_info: contextual,
        get_meeting_participant: contextual,
        send_meeting_notification: {
            support: "native",
            availability: "permission",
            permissions: ["OnlineMeetingNotification.Send.Chat"],
        },
        get_user_token: {
            ...contextual,
            availability: "permission",
            permissions: ["Azure Bot OAuth connection"],
        },
        get_user_aad_tokens: {
            ...contextual,
            availability: "permission",
            permissions: ["Azure Bot OAuth connection"],
        },
        get_user_token_status: {
            ...contextual,
            availability: "permission",
            permissions: ["Azure Bot OAuth connection"],
        },
        sign_out_user: {
            ...contextual,
            availability: "permission",
            permissions: ["Azure Bot OAuth connection"],
        },
        exchange_user_token: {
            ...contextual,
            availability: "permission",
            permissions: ["Azure Bot OAuth connection"],
        },
        call_graph_api: {
            support: "native",
            availability: "permission",
            permissions: ["Microsoft Graph application permissions for the requested resource"],
        },
    },
    events: {
        message: { support: "native", scenes: ["private", "group", "channel"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        group_increase: { support: "native", scenes: ["group", "channel"] },
        group_decrease: { support: "native", scenes: ["group", "channel"] },
        interaction: { support: "native", note: "invoke 与 Adaptive Card 提交" },
        custom: {
            support: "native",
            note: "typing、installationUpdate、会议和其他 Activity 无损投影",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: {
            support: "native",
            direction: "both",
            note: "生成/解析用户 mention entity；Teams Bot 不支持通用 @all entity",
        },
        reply: { support: "native", direction: "both" },
        image: {
            support: "native",
            direction: "both",
            note: "发送端需提供 Teams 可访问的 HTTPS contentUrl",
        },
        file: {
            support: "native",
            direction: "both",
            availability: "context",
            note: "普通附件需 HTTPS contentUrl；真实上传使用文件 consent/file-info 或 Graph 流程",
        },
        video: {
            support: "native",
            direction: "both",
            note: "发送端需提供 Teams 可访问的 HTTPS contentUrl",
        },
        audio: {
            support: "native",
            direction: "both",
            note: "发送端需提供 Teams 可访问的 HTTPS contentUrl",
        },
        adaptive_card: { support: "native", direction: "both" },
        card: { support: "native", direction: "both" },
        teams_activity: { support: "native", direction: "send" },
        teams_value: { support: "native", direction: "receive" },
    },
    transports: {
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 TeamsBot.ingestHttp() 复用 Agents SDK 认证与 Turn 管线",
        },
    },
});
