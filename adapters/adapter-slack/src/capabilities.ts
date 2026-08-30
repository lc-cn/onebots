import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { SLACK_PLATFORM_ACTIONS } from "./platform-actions.js";
import { SLACK_CALL_ACTION_NAMES, SLACK_CALL_READ_ACTION_NAMES } from "./platform-actions-calls.js";
import { SLACK_LIST_ACTION_NAMES, SLACK_LIST_READ_ACTION_NAMES } from "./platform-actions-lists.js";
import {
    SLACK_REMOTE_FILE_ACTION_NAMES,
    SLACK_REMOTE_FILE_READ_ACTION_NAMES,
    SLACK_REMOTE_FILE_SHARE_ACTION_NAMES,
} from "./platform-actions-remote-files.js";

const platformActions = definePlatformActionCapabilities(SLACK_PLATFORM_ACTIONS, action => {
    if (SLACK_LIST_ACTION_NAMES.has(action)) {
        return {
            support: "native",
            availability: "permission",
            permissions: [SLACK_LIST_READ_ACTION_NAMES.has(action) ? "lists:read" : "lists:write"],
            note: "Slack Lists 仅适用于支持该功能的付费工作区",
        };
    }
    if (SLACK_CALL_ACTION_NAMES.has(action)) {
        return {
            support: "native",
            availability: "permission",
            permissions: [SLACK_CALL_READ_ACTION_NAMES.has(action) ? "calls:read" : "calls:write"],
        };
    }
    if (SLACK_REMOTE_FILE_ACTION_NAMES.has(action)) {
        const permission = SLACK_REMOTE_FILE_READ_ACTION_NAMES.has(action)
            ? "remote_files:read"
            : SLACK_REMOTE_FILE_SHARE_ACTION_NAMES.has(action)
              ? "remote_files:share"
              : "remote_files:write";
        return { support: "native", availability: "permission", permissions: [permission] };
    }
    return { support: "native", availability: "context" };
});

/** Slack Web API/Events API 当前可用的能力。 */
export const slackCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        ...platformActions,
        send_message: { support: "native", scenes: ["private", "direct", "channel"] },
        delete_message: {
            support: "native",
            availability: "context",
            note: "需提供 scene_id，或消息已由当前进程收发",
        },
        update_message: {
            support: "native",
            availability: "context",
            note: "需提供 scene_id，或消息已由当前进程收发",
        },
        get_message: { support: "native", availability: "context" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_friend_list: { support: "native", note: "按工作区用户目录投影" },
        get_friend_info: { support: "emulated", note: "按工作区用户投影" },
        get_channel_list: { support: "native" },
        get_channel_info: { support: "native" },
        get_channel_member_list: { support: "native" },
        get_channel_member_info: { support: "native" },
        get_file: { support: "native", availability: "permission" },
        delete_file: { support: "native", availability: "permission" },
        create_channel: { support: "native", availability: "permission" },
        update_channel: { support: "native", availability: "permission" },
        delete_channel: { support: "native", availability: "permission" },
        invite_channel_member: { support: "native", availability: "permission" },
        kick_channel_member: {
            support: "native",
            availability: "permission",
            permissions: ["channels:manage"],
        },
        call_slack_api: {
            support: "native",
            availability: "context",
            note: "受当前 token scopes 约束的原生 Slack Web API 入口",
        },
        add_reaction: { support: "native", permissions: ["reactions:write"] },
        remove_reaction: { support: "native", permissions: ["reactions:write"] },
        add_pin: { support: "native", permissions: ["pins:write"] },
        remove_pin: { support: "native", permissions: ["pins:write"] },
        get_thread_replies: { support: "native", availability: "permission" },
        open_conversation: { support: "native", availability: "permission" },
        archive_channel: { support: "native", availability: "permission" },
        unarchive_channel: { support: "native", availability: "permission" },
        rename_channel: { support: "native", availability: "permission" },
        set_channel_topic: { support: "native", availability: "permission" },
        set_channel_purpose: { support: "native", availability: "permission" },
        join_channel: { support: "native", availability: "permission" },
        invite_channel_members: { support: "native", availability: "permission" },
        leave_channel: { support: "native", availability: "permission" },
        schedule_message: { support: "native", permissions: ["chat:write"] },
        delete_scheduled_message: { support: "native", permissions: ["chat:write"] },
        list_scheduled_messages: { support: "native", permissions: ["chat:write"] },
        add_bookmark: { support: "native", availability: "permission" },
        edit_bookmark: { support: "native", availability: "permission" },
        remove_bookmark: { support: "native", availability: "permission" },
        list_bookmarks: { support: "native", availability: "permission" },
        start_message_stream: {
            support: "native",
            permissions: ["chat:write"],
            note: "支持 markdown、结构化 chunks、timeline/plan 任务展示与消息署名",
        },
        append_message_stream: {
            support: "native",
            permissions: ["chat:write"],
            note: "支持 markdown 或结构化 chunks，且保持起始流的内容模式",
        },
        stop_message_stream: {
            support: "native",
            permissions: ["chat:write"],
            note: "支持结尾 chunks、Block Kit、metadata 与 Agent Session 状态",
        },
        validate_blocks: { support: "native", availability: "permission" },
        create_canvas: { support: "native", availability: "permission" },
        edit_canvas: { support: "native", availability: "permission" },
        delete_canvas: { support: "native", availability: "permission" },
        lookup_canvas_sections: { support: "native", availability: "permission" },
        set_canvas_access: { support: "native", availability: "permission" },
        delete_canvas_access: { support: "native", availability: "permission" },
        create_channel_canvas: { support: "native", availability: "permission" },
        set_agent_session_status: {
            support: "native",
            permissions: ["chat:write"],
            note: "管理 Slack Agent Session 生命周期并启用原生停止按钮",
        },
        rename_agent_session: {
            support: "native",
            permissions: ["chat:write"],
        },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
    },
    events: {
        message: { support: "native", scenes: ["private", "direct", "channel"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: { support: "native" },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        user_added: { support: "native" },
        user_updated: { support: "native" },
        interaction: { support: "native" },
        app_context_changed: {
            support: "native",
            note: "保留按相关性排序的频道、线程、Canvas 与 List 活跃上下文",
        },
        app_home_opened: {
            support: "native",
            note: "保留 Agent View 的当前 App Home 上下文",
        },
        agent_session_stopped: {
            support: "native",
            note: "用户点击 Slack 原生停止按钮",
        },
        agent_session_title_changed: { support: "native" },
        native_event: {
            support: "native",
            note: "所有未标准化 Events API 事件以 custom notice 和 raw_event 无损交付",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        reply: { support: "native", direction: "both" },
        slack_message: {
            support: "native",
            direction: "send",
            note: "承载 Block Kit、attachments 与 chat.postMessage 原生选项",
        },
    },
    transports: {
        socket_mode: { support: "native", mode: "websocket" },
        webhook: { support: "native", mode: "webhook" },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingest()、ingestHttp() 或 acceptHttp(Request) 接入既有 Host",
        },
    },
});
