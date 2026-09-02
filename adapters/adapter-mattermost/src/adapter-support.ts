import { Account, Adapter } from "onebots";
import { MattermostError } from "./errors.js";
import type {
    MattermostChannelMember,
    MattermostConfig,
    MattermostTeamMember,
    MattermostUser,
} from "./types.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function normalizeMattermostConfig(config: Account.Config<"mattermost">): MattermostConfig {
    return {
        account_id: config.account_id,
        server_url: config.server_url,
        access_token: config.access_token,
        receive_mode: config.receive_mode || "websocket",
        event_types: config.event_types?.length ? [...config.event_types] : undefined,
        team_ids: config.team_ids?.length ? [...config.team_ids] : undefined,
        channel_ids: config.channel_ids?.length ? [...config.channel_ids] : undefined,
        reconnect_initial_delay_ms: config.reconnect_initial_delay_ms,
        reconnect_max_delay_ms: config.reconnect_max_delay_ms,
        connect_timeout_ms: config.connect_timeout_ms,
        max_response_bytes: config.max_response_bytes,
    };
}

/** 上传只接受调用方已读取的 base64，避免适配器越权读取宿主路径或发起 SSRF。 */
export function materializeMattermostUpload(params: Adapter.UploadFileParams): Blob {
    if (params.path) {
        throw new MattermostError("Mattermost upload_file 不读取宿主本地路径，请传入 base64 data", {
            code: "MATTERMOST_LOCAL_PATH_REJECTED",
        });
    }
    if (params.url) {
        throw new MattermostError("Mattermost upload_file 不抓取远程 URL，请传入 base64 data", {
            code: "MATTERMOST_REMOTE_SOURCE_REJECTED",
        });
    }
    if (!params.data) throw MattermostError.invalid("Mattermost upload_file 必须提供 base64 data");
    const match = params.data.match(/^data:([^;,]+);base64,(.*)$/su);
    const encoded = match ? match[2] : params.data;
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
        throw MattermostError.invalid("upload_file.data 不是有效 base64");
    }
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw MattermostError.invalid("Mattermost 上传源必须介于 1 byte 与 100 MiB");
    }
    return new Blob([bytes], { type: match?.[1] || contentType(params.name) });
}

export function displayName(user: MattermostUser): string {
    const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
    return user.nickname || full || user.username;
}

export function teamRole(member: MattermostTeamMember): string {
    if (member.scheme_admin || member.roles.split(" ").includes("team_admin")) return "admin";
    if (member.scheme_guest || member.roles.split(" ").includes("team_guest")) return "guest";
    return "member";
}

export function channelRole(member: MattermostChannelMember): "owner" | "admin" | "member" {
    return member.scheme_admin || member.roles.split(" ").includes("channel_admin")
        ? "admin"
        : "member";
}

function contentType(filename: string): string {
    const extension = filename.toLowerCase().split(".").at(-1);
    return (
        {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            mp4: "video/mp4",
            webm: "video/webm",
            mov: "video/quicktime",
            mp3: "audio/mpeg",
            ogg: "audio/ogg",
            wav: "audio/wav",
            pdf: "application/pdf",
            txt: "text/plain",
        }[extension || ""] || "application/octet-stream"
    );
}
