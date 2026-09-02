import { MattermostError } from "./errors.js";
import type {
    MattermostChannel,
    MattermostChannelMember,
    MattermostDelivery,
    MattermostFileInfo,
    MattermostPost,
    MattermostPostList,
    MattermostPostMetadata,
    MattermostReaction,
    MattermostStatus,
    MattermostTeam,
    MattermostTeamMember,
    MattermostUploadResult,
    MattermostUser,
    MattermostWebSocketEvent,
    MattermostWebSocketResponse,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMattermostUser(value: unknown): MattermostUser {
    const record = requireRecord(value, "Mattermost user");
    return {
        id: requireId(record.id, "user.id"),
        create_at: requireTimestamp(record.create_at, "user.create_at"),
        update_at: requireTimestamp(record.update_at, "user.update_at"),
        delete_at: requireTimestamp(record.delete_at, "user.delete_at"),
        username: requireString(record.username, "user.username"),
        first_name: optionalString(record.first_name),
        last_name: optionalString(record.last_name),
        nickname: optionalString(record.nickname),
        email: optionalString(record.email),
        email_verified: optionalBoolean(record.email_verified),
        auth_service: optionalString(record.auth_service),
        roles: optionalString(record.roles),
        locale: optionalString(record.locale),
        position: optionalString(record.position),
        props: optionalRecord(record.props),
        notify_props: optionalRecord(record.notify_props),
        timezone: optionalRecord(record.timezone),
        is_bot: optionalBoolean(record.is_bot),
    };
}

export function parseMattermostTeam(value: unknown): MattermostTeam {
    const record = requireRecord(value, "Mattermost team");
    const type = record.type;
    if (type !== "O" && type !== "I") throw MattermostError.invalid("team.type 无效");
    return {
        id: requireId(record.id, "team.id"),
        create_at: requireTimestamp(record.create_at, "team.create_at"),
        update_at: requireTimestamp(record.update_at, "team.update_at"),
        delete_at: requireTimestamp(record.delete_at, "team.delete_at"),
        display_name: requireString(record.display_name, "team.display_name"),
        name: requireString(record.name, "team.name"),
        type,
        description: optionalString(record.description),
        email: optionalString(record.email),
        company_name: optionalString(record.company_name),
        allowed_domains: optionalString(record.allowed_domains),
        invite_id: optionalString(record.invite_id),
        scheme_id: optionalString(record.scheme_id),
    };
}

export function parseMattermostChannel(value: unknown): MattermostChannel {
    const record = requireRecord(value, "Mattermost channel");
    const type = record.type;
    if (!(["O", "P", "D", "G"] as unknown[]).includes(type)) {
        throw MattermostError.invalid("channel.type 必须是 O、P、D 或 G");
    }
    return {
        id: requireId(record.id, "channel.id"),
        create_at: requireTimestamp(record.create_at, "channel.create_at"),
        update_at: requireTimestamp(record.update_at, "channel.update_at"),
        delete_at: requireTimestamp(record.delete_at, "channel.delete_at"),
        team_id: requireString(record.team_id, "channel.team_id", true),
        type: type as MattermostChannel["type"],
        display_name: requireString(record.display_name, "channel.display_name", true),
        name: requireString(record.name, "channel.name", true),
        header: optionalString(record.header),
        purpose: optionalString(record.purpose),
        last_post_at: optionalTimestamp(record.last_post_at, "channel.last_post_at"),
        total_msg_count: optionalInteger(record.total_msg_count, "channel.total_msg_count"),
        creator_id: optionalString(record.creator_id),
        scheme_id: optionalString(record.scheme_id),
        group_constrained: optionalBoolean(record.group_constrained),
        shared: optionalBoolean(record.shared),
    };
}

export function parseMattermostPost(value: unknown): MattermostPost {
    const record = requireRecord(value, "Mattermost post");
    return {
        id: requireId(record.id, "post.id"),
        create_at: requireTimestamp(record.create_at, "post.create_at"),
        update_at: requireTimestamp(record.update_at, "post.update_at"),
        edit_at: requireTimestamp(record.edit_at, "post.edit_at"),
        delete_at: requireTimestamp(record.delete_at, "post.delete_at"),
        is_pinned: requireBoolean(record.is_pinned, "post.is_pinned"),
        user_id: requireId(record.user_id, "post.user_id"),
        channel_id: requireId(record.channel_id, "post.channel_id"),
        root_id: requireString(record.root_id, "post.root_id", true),
        original_id: requireString(record.original_id, "post.original_id", true),
        message: requireString(record.message, "post.message", true),
        type: requireString(record.type, "post.type", true),
        props: requireRecord(record.props, "post.props"),
        hashtags: requireString(record.hashtags, "post.hashtags", true),
        file_ids:
            record.file_ids === undefined
                ? []
                : requireStringArray(record.file_ids, "post.file_ids"),
        pending_post_id: requireString(record.pending_post_id, "post.pending_post_id", true),
        reply_count: optionalInteger(record.reply_count, "post.reply_count"),
        last_reply_at: optionalTimestamp(record.last_reply_at, "post.last_reply_at"),
        participants:
            record.participants === null
                ? undefined
                : optionalStringArray(record.participants, "post.participants"),
        metadata: parsePostMetadata(record.metadata),
    };
}

export function parseMattermostReaction(value: unknown): MattermostReaction {
    const record = requireRecord(value, "Mattermost reaction");
    return {
        user_id: requireId(record.user_id, "reaction.user_id"),
        post_id: requireId(record.post_id, "reaction.post_id"),
        emoji_name: requireString(record.emoji_name, "reaction.emoji_name"),
        create_at: requireTimestamp(record.create_at, "reaction.create_at"),
    };
}

function parsePostMetadata(value: unknown): MattermostPostMetadata | undefined {
    if (value === undefined) return undefined;
    const record = requireRecord(value, "post.metadata");
    const metadata: MattermostPostMetadata = { ...record };
    if (record.files !== undefined) {
        if (!Array.isArray(record.files)) {
            throw MattermostError.invalid("post.metadata.files 必须是数组");
        }
        metadata.files = record.files.map(parseMattermostFileInfo);
    }
    if (record.reactions !== undefined) {
        if (!Array.isArray(record.reactions)) {
            throw MattermostError.invalid("post.metadata.reactions 必须是数组");
        }
        metadata.reactions = record.reactions.map(parseMattermostReaction);
    }
    if (record.emojis !== undefined) {
        if (!Array.isArray(record.emojis)) {
            throw MattermostError.invalid("post.metadata.emojis 必须是数组");
        }
        metadata.emojis = structuredClone(record.emojis);
    }
    if (record.embeds !== undefined) {
        if (!Array.isArray(record.embeds)) {
            throw MattermostError.invalid("post.metadata.embeds 必须是数组");
        }
        metadata.embeds = structuredClone(record.embeds);
    }
    if (record.images !== undefined) {
        metadata.images = requireRecord(record.images, "post.metadata.images");
    }
    if (record.priority !== undefined) {
        const priority = requireRecord(record.priority, "post.metadata.priority");
        metadata.priority = {
            priority: optionalString(priority.priority),
            requested_ack: optionalBoolean(priority.requested_ack),
        };
    }
    return metadata;
}

export function parseMattermostFileInfo(value: unknown): MattermostFileInfo {
    const record = requireRecord(value, "Mattermost file info");
    return {
        id: requireId(record.id, "file.id"),
        user_id: requireId(record.user_id, "file.user_id"),
        post_id: requireString(record.post_id, "file.post_id", true),
        channel_id: requireId(record.channel_id, "file.channel_id"),
        create_at: requireTimestamp(record.create_at, "file.create_at"),
        update_at: requireTimestamp(record.update_at, "file.update_at"),
        delete_at: requireTimestamp(record.delete_at, "file.delete_at"),
        name: requireString(record.name, "file.name"),
        extension: optionalString(record.extension),
        size: requireNonNegativeInteger(record.size, "file.size"),
        mime_type: requireString(record.mime_type, "file.mime_type", true),
        width: optionalInteger(record.width, "file.width"),
        height: optionalInteger(record.height, "file.height"),
        has_preview_image: optionalBoolean(record.has_preview_image),
        mini_preview: optionalString(record.mini_preview),
    };
}

export function parseMattermostPostList(value: unknown): MattermostPostList {
    const record = requireRecord(value, "Mattermost post list");
    const postsRecord = requireRecord(record.posts, "post list.posts");
    const posts: Record<string, MattermostPost> = {};
    for (const [id, post] of Object.entries(postsRecord)) {
        const parsed = parseMattermostPost(post);
        if (parsed.id !== id) throw MattermostError.invalid("post list 的 key 与 post.id 不一致");
        posts[id] = parsed;
    }
    const order = requireStringArray(record.order, "post list.order");
    if (order.some(id => !posts[id])) {
        throw MattermostError.invalid("post list.order 引用了不存在的 post");
    }
    return {
        order,
        posts,
        next_post_id: optionalString(record.next_post_id),
        prev_post_id: optionalString(record.prev_post_id),
    };
}

export function parseMattermostUploadResult(value: unknown): MattermostUploadResult {
    const record = requireRecord(value, "Mattermost upload result");
    if (!Array.isArray(record.file_infos)) {
        throw MattermostError.invalid("upload result.file_infos 必须是数组");
    }
    return {
        file_infos: record.file_infos.map(parseMattermostFileInfo),
        client_ids: optionalStringArray(record.client_ids, "upload result.client_ids"),
    };
}

export function parseMattermostStatus(value: unknown): MattermostStatus {
    const record = requireRecord(value, "Mattermost status");
    const status = record.status;
    if (!(["online", "away", "dnd", "offline"] as unknown[]).includes(status)) {
        throw MattermostError.invalid("status.status 无效");
    }
    return {
        user_id: requireId(record.user_id, "status.user_id"),
        status: status as MattermostStatus["status"],
        manual: optionalBoolean(record.manual),
        last_activity_at: optionalTimestamp(record.last_activity_at, "status.last_activity_at"),
    };
}

export function parseMattermostTeamMember(value: unknown): MattermostTeamMember {
    const record = requireRecord(value, "Mattermost team member");
    return {
        team_id: requireId(record.team_id, "team member.team_id"),
        user_id: requireId(record.user_id, "team member.user_id"),
        roles: requireString(record.roles, "team member.roles", true),
        delete_at: requireTimestamp(record.delete_at, "team member.delete_at"),
        scheme_user: requireBoolean(record.scheme_user, "team member.scheme_user"),
        scheme_admin: requireBoolean(record.scheme_admin, "team member.scheme_admin"),
        scheme_guest: requireBoolean(record.scheme_guest, "team member.scheme_guest"),
    };
}

export function parseMattermostChannelMember(value: unknown): MattermostChannelMember {
    const record = requireRecord(value, "Mattermost channel member");
    return {
        channel_id: requireId(record.channel_id, "channel member.channel_id"),
        user_id: requireId(record.user_id, "channel member.user_id"),
        roles: requireString(record.roles, "channel member.roles", true),
        last_viewed_at: requireTimestamp(record.last_viewed_at, "channel member.last_viewed_at"),
        msg_count: requireNonNegativeInteger(record.msg_count, "channel member.msg_count"),
        mention_count: requireNonNegativeInteger(
            record.mention_count,
            "channel member.mention_count",
        ),
        mention_count_root: optionalInteger(
            record.mention_count_root,
            "channel member.mention_count_root",
        ),
        notify_props: optionalRecord(record.notify_props),
        last_update_at: optionalTimestamp(record.last_update_at, "channel member.last_update_at"),
        scheme_user: requireBoolean(record.scheme_user, "channel member.scheme_user"),
        scheme_admin: requireBoolean(record.scheme_admin, "channel member.scheme_admin"),
        scheme_guest: requireBoolean(record.scheme_guest, "channel member.scheme_guest"),
    };
}

export function parseMattermostWebSocketMessage(
    value: unknown,
): MattermostWebSocketEvent | MattermostWebSocketResponse {
    const record = requireRecord(value, "Mattermost WebSocket message");
    if (typeof record.event === "string") {
        if (!record.event || /\s/u.test(record.event)) {
            throw MattermostError.invalid("WebSocket event 名称无效");
        }
        const broadcast = requireRecord(record.broadcast, "WebSocket broadcast");
        return {
            event: record.event,
            data: requireRecord(record.data, "WebSocket data"),
            broadcast: {
                omit_users:
                    broadcast.omit_users === null
                        ? null
                        : optionalStringArray(broadcast.omit_users, "broadcast.omit_users"),
                user_id: optionalString(broadcast.user_id),
                channel_id: optionalString(broadcast.channel_id),
                team_id: optionalString(broadcast.team_id),
                connection_id: optionalString(broadcast.connection_id),
                omit_connection_id: optionalString(broadcast.omit_connection_id),
            },
            seq: requireNonNegativeInteger(record.seq, "WebSocket seq"),
        };
    }
    if (record.status !== "OK" && record.status !== "FAIL") {
        throw MattermostError.invalid("WebSocket message 既不是 event 也不是 response");
    }
    const response: MattermostWebSocketResponse = {
        status: record.status,
        seq_reply: requireNonNegativeInteger(record.seq_reply, "WebSocket seq_reply"),
        data: optionalRecord(record.data),
    };
    if (record.status === "FAIL") {
        const error = requireRecord(record.error, "WebSocket error");
        response.error = {
            id: requireString(error.id, "WebSocket error.id"),
            message: requireString(error.message, "WebSocket error.message"),
            detailed_error: optionalString(error.detailed_error),
            request_id: optionalString(error.request_id),
        };
    }
    return response;
}

export function parseMattermostDelivery(event: MattermostWebSocketEvent): MattermostDelivery {
    const delivery: MattermostDelivery = { event };
    const entity = (field: string): unknown => decodeJsonField(event.data[field], field);
    if (["posted", "post_edited", "post_deleted", "ephemeral_message"].includes(event.event)) {
        delivery.post = parseMattermostPost(entity("post"));
    }
    if (event.event === "reaction_added" || event.event === "reaction_removed") {
        delivery.reaction = parseMattermostReaction(entity("reaction"));
    }
    if (["new_user", "user_updated"].includes(event.event)) {
        delivery.user = parseMattermostUser(entity("user"));
    }
    if (["channel_created", "channel_updated", "channel_converted"].includes(event.event)) {
        delivery.channel = parseMattermostChannel(entity("channel"));
    }
    if (["added_to_team", "update_team", "delete_team"].includes(event.event)) {
        delivery.team = parseMattermostTeam(entity("team"));
    }
    return delivery;
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw MattermostError.invalid(`${field} 必须是对象`);
    return value;
}

export function requireString(value: unknown, field: string, allowEmpty = false): string {
    if (typeof value !== "string" || (!allowEmpty && !value)) {
        throw MattermostError.invalid(`${field} 必须是${allowEmpty ? "" : "非空"}字符串`);
    }
    return value;
}

export function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function decodeJsonField(value: unknown, field: string): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        throw MattermostError.invalid(`WebSocket data.${field} 不是有效 JSON`);
    }
}

function requireId(value: unknown, field: string): string {
    const id = requireString(value, field);
    if (!/^[a-z0-9]+$/u.test(id)) throw MattermostError.invalid(`${field} 不是有效 Mattermost ID`);
    return id;
}

function requireTimestamp(value: unknown, field: string): number {
    return requireNonNegativeInteger(value, field);
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireTimestamp(value, field);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw MattermostError.invalid(`${field} 必须是非负安全整数`);
    }
    return Number(value);
}

function optionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireNonNegativeInteger(value, field);
}

function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw MattermostError.invalid(`${field} 必须是布尔值`);
    return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
    return value === undefined ? undefined : requireRecord(value, "对象字段");
}

function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
        throw MattermostError.invalid(`${field} 必须是字符串数组`);
    }
    return [...value];
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
    return value === undefined ? undefined : requireStringArray(value, field);
}
