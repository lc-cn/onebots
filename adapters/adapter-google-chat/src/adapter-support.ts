import { Account, Adapter } from "onebots";
import { GoogleChatError } from "./errors.js";
import type { GoogleChatConfig } from "./types.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** 宿主负责读取文件；适配器不会读取本机路径或抓取外部 URL。 */
export function materializeGoogleChatUpload(params: Adapter.UploadFileParams): Uint8Array {
    if (params.path) {
        throw new GoogleChatError("Google Chat upload_file 不读取宿主本地路径", {
            code: "GOOGLE_CHAT_LOCAL_PATH_REJECTED",
        });
    }
    if (params.url) {
        throw new GoogleChatError("Google Chat upload_file 不抓取远程 URL", {
            code: "GOOGLE_CHAT_REMOTE_SOURCE_REJECTED",
        });
    }
    if (!params.data) throw GoogleChatError.invalid("upload_file 必须提供 base64 data");
    const separator = params.data.indexOf(",");
    const encoded = params.data.startsWith("data:")
        ? params.data.slice(separator + 1)
        : params.data;
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
        throw GoogleChatError.invalid("upload_file.data 不是有效 base64");
    }
    const data = new Uint8Array(Buffer.from(encoded, "base64"));
    if (data.byteLength > MAX_UPLOAD_BYTES) {
        throw GoogleChatError.invalid("Google Chat 上传源超过 200 MiB 限制");
    }
    return data;
}

export function normalizeGoogleChatConfig(
    config: Account.Config<"google-chat">,
    accountPath: string,
): GoogleChatConfig {
    return {
        account_id: config.account_id,
        auth_mode: config.auth_mode,
        service_account_email: config.service_account_email,
        service_account_private_key: config.service_account_private_key,
        access_token: config.access_token,
        oauth_scopes: config.oauth_scopes,
        principal_name: config.principal_name,
        app_display_name: config.app_display_name,
        receive_mode: config.receive_mode,
        http_path:
            (config.receive_mode || "interaction-http") === "manual"
                ? config.http_path
                : config.http_path || `${accountPath}/events`,
        verification_mode: config.verification_mode,
        verification_audience: config.verification_audience,
        pubsub_service_account_email: config.pubsub_service_account_email,
        api_base_url: config.api_base_url,
        event_types: config.event_types,
    };
}

export function googleChatContentType(name: string, dataUri?: string): string {
    const fromData = dataUri?.match(/^data:([^;,]+)[;,]/u)?.[1];
    if (fromData) return fromData;
    const extension = name.split(".").at(-1)?.toLowerCase();
    return (
        {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            mp4: "video/mp4",
            mp3: "audio/mpeg",
            ogg: "audio/ogg",
            pdf: "application/pdf",
            txt: "text/plain",
        }[extension || ""] || "application/octet-stream"
    );
}
