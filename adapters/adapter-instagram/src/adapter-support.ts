import { Account, Adapter } from "onebots";
import { InstagramError } from "./errors.js";
import type { InstagramConfig } from "./types.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function normalizeInstagramConfig(config: Account.Config<"instagram">): InstagramConfig {
    const receiveMode = config.receive_mode || "webhook";
    return {
        ...config,
        receive_mode: receiveMode,
        http_path:
            receiveMode === "manual"
                ? config.http_path
                : config.http_path || `/instagram/${config.account_id}/events`,
        api_version: config.api_version || "v25.0",
        api_origin: config.api_origin || "https://graph.instagram.com",
        subscribed_fields: config.subscribed_fields?.length
            ? [...config.subscribed_fields]
            : ["messages", "messaging_postbacks", "messaging_seen", "message_reactions"],
    };
}

export function instagramUploadSource(
    params: Adapter.UploadFileParams,
): { url: string } | { blob: Blob; filename: string } {
    const sources = [params.url, params.path, params.data].filter(value => value !== undefined);
    if (sources.length !== 1) {
        throw InstagramError.invalid("upload_file 必须且只能提供 url、path、data 之一");
    }
    if (params.path) {
        throw new InstagramError("Instagram upload_file 不读取宿主本地路径", {
            code: "INSTAGRAM_LOCAL_PATH_REJECTED",
        });
    }
    if (params.url) {
        if (!URL.canParse(params.url)) {
            throw InstagramError.invalid("upload_file.url 不是有效 URL");
        }
        const url = new URL(params.url);
        if (url.protocol !== "https:" || url.username || url.password) {
            throw InstagramError.invalid("upload_file.url 必须是无凭据 HTTPS URL");
        }
        return { url: url.toString() };
    }
    const raw = params.data || "";
    const match = raw.match(/^data:([^;,]+);base64,(.*)$/su);
    const encoded = match ? match[2] : raw;
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
        throw InstagramError.invalid("upload_file.data 不是有效 base64");
    }
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw InstagramError.invalid("upload_file.data 必须介于 1 byte 与 25 MiB");
    }
    return {
        blob: new Blob([bytes], { type: match?.[1] || contentType(params.name) }),
        filename: params.name,
    };
}

export function instagramAttachmentType(filename: string): "image" | "video" | "audio" {
    const mime = contentType(filename);
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    throw InstagramError.invalid("Instagram Messaging 仅支持 image、video 与 audio 附件");
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
            mov: "video/quicktime",
            webm: "video/webm",
            mp3: "audio/mpeg",
            ogg: "audio/ogg",
            wav: "audio/wav",
        }[extension || ""] || "application/octet-stream"
    );
}
