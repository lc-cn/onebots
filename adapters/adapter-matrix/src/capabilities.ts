import {
    defineAdapterCapabilities,
    definePlatformActionCapabilities,
    restrictAdapterEventCapabilities,
    type AdapterCapabilityManifest,
} from "onebots";
import { MATRIX_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { MatrixConfig } from "./types.js";

export const MATRIX_EVENT_TYPES = [
    "m.room.message",
    "m.sticker",
    "m.reaction",
    "m.room.redaction",
    "m.room.member",
    "m.room.name",
    "m.room.topic",
    "m.room.avatar",
    "m.room.create",
    "m.room.power_levels",
    "m.room.encryption",
    "m.room.encrypted",
    "m.typing",
    "m.receipt",
    "m.presence",
    "m.direct",
] as const;

const permission = {
    support: "native" as const,
    availability: "permission" as const,
    permissions: ["Matrix 房间 power level / homeserver policy"],
};

const platformActions = definePlatformActionCapabilities(MATRIX_PLATFORM_ACTIONS, action => {
    if (["ban_matrix_member", "unban_matrix_member", "send_matrix_state_event"].includes(action)) {
        return permission;
    }
    if (action === "ping_matrix_appservice") {
        return {
            support: "native",
            availability: "context",
            note: "仅 appservice 模式且 homeserver 已安装对应 registration 时可用",
        } as const;
    }
    return { support: "native" } as const;
});

/** Matrix Client-Server v3 与 Application Service v1 的真实能力边界。 */
export const matrixCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["group", "direct"] },
        delete_message: permission,
        get_message: { support: "native", availability: "context" },
        get_message_history: { support: "native" },
        update_message: { support: "native", availability: "context" },
        mark_message_as_read: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "native" },
        get_group_list: { support: "native" },
        get_group_info: { support: "native" },
        set_group_name: permission,
        leave_group: { support: "native" },
        get_group_member_list: { support: "native" },
        get_group_member_info: { support: "native" },
        invite_group_member: permission,
        kick_group_member: permission,
        handle_group_request: { support: "native", availability: "context" },
        send_group_message_reaction: { support: "native", availability: "context" },
        upload_file: { support: "native" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["group", "direct"] },
        message_updated: { support: "native" },
        message_deleted: { support: "native" },
        reaction_added: { support: "native" },
        reaction_removed: {
            support: "native",
            availability: "context",
            note: "Matrix 通过 redaction 撤销 reaction；原始 redaction 同时无损保留",
        },
        member_joined: { support: "native" },
        member_left: { support: "native" },
        user_updated: { support: "native" },
        channel_updated: { support: "native" },
        typing_started: { support: "native" },
        typing_stopped: { support: "native" },
        message_status: { support: "native", note: "投影 m.receipt，包括线程回执" },
        group_invitation: { support: "native" },
        custom: {
            support: "native",
            note: "未知状态、to-device、account-data 与加密事件保留 raw_event；本适配器不伪装 E2EE 解密",
        },
    },
    segments: {
        text: { support: "native", direction: "both" },
        at: { support: "native", direction: "send" },
        emoji: { support: "native", direction: "send" },
        image: { support: "native", direction: "both" },
        video: { support: "native", direction: "both" },
        audio: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        location: { support: "native", direction: "both" },
        sticker: { support: "native", direction: "receive" },
        reply: { support: "native", direction: "receive" },
        thread: { support: "native", direction: "receive" },
    },
    transports: {
        sync: { support: "native", mode: "polling", note: "无限重试的 Client-Server /sync" },
        appservice: {
            support: "native",
            mode: "webhook",
            note: "标准 AppService v1 transaction 与 ping，复用现有 HTTP Host",
        },
        manual: {
            support: "native",
            mode: "native",
            note: "通过 ingest()/ingestHttp()/acceptHttp() 接入已有连接或 Host",
        },
    },
});

const canonicalEventTypes: Readonly<Record<string, readonly string[]>> = {
    message: ["m.room.message", "m.sticker"],
    message_updated: ["m.room.message"],
    message_deleted: ["m.room.redaction"],
    reaction_added: ["m.reaction"],
    reaction_removed: ["m.reaction", "m.room.redaction"],
    member_joined: ["m.room.member"],
    member_left: ["m.room.member"],
    user_updated: ["m.presence", "m.room.member"],
    channel_updated: ["m.room.name", "m.room.topic", "m.room.avatar"],
    typing_started: ["m.typing"],
    typing_stopped: ["m.typing"],
    message_status: ["m.receipt"],
    group_invitation: ["m.room.member"],
};

export function describeMatrixCapabilities(
    config: Pick<MatrixConfig, "event_types" | "receive_mode">,
): AdapterCapabilityManifest {
    if ((config.receive_mode || "sync") !== "sync" || !config.event_types?.length) {
        return matrixCapabilities;
    }
    const enabled = new Set(config.event_types);
    const customTypes = new Set([
        "m.room.create",
        "m.room.power_levels",
        "m.room.encryption",
        "m.room.encrypted",
        "m.direct",
    ]);
    const available = new Set<string>();
    if (
        config.event_types.some(
            type =>
                customTypes.has(type) || !(MATRIX_EVENT_TYPES as readonly string[]).includes(type),
        )
    ) {
        available.add("custom");
    }
    for (const [event, nativeTypes] of Object.entries(canonicalEventTypes)) {
        const reachable =
            event === "reaction_removed"
                ? nativeTypes.every(type => enabled.has(type))
                : nativeTypes.some(type => enabled.has(type));
        if (reachable) available.add(event);
    }
    return restrictAdapterEventCapabilities(matrixCapabilities, available, event => {
        const required = canonicalEventTypes[event];
        return required
            ? `event_types 未包含可生成此事件的 Matrix 类型：${required.join(", ")}`
            : "当前 /sync 过滤器不会生成此 canonical 事件";
    });
}
