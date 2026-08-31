import { Account, Adapter } from "onebots";
import { FacebookMessengerError } from "./errors.js";
import type { FacebookMessengerConfig } from "./types.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function normalizeFacebookMessengerConfig(
    config: Account.Config<"facebook-messenger">,
): FacebookMessengerConfig {
    const receiveMode = config.receive_mode || "webhook";
    return {
        ...config,
        receive_mode: receiveMode,
        http_path:
            receiveMode === "manual"
                ? config.http_path
                : config.http_path || `/facebook-messenger/${config.account_id}/events`,
        api_version: config.api_version || "v25.0",
        subscribed_fields: config.subscribed_fields?.length
            ? [...config.subscribed_fields]
            : ["messages", "message_deliveries", "message_reads", "messaging_postbacks"],
    };
}

/** upload_file 的宿主边界：远程 URL 交给 Meta；本地路径不由网关读取。 */
export function messengerUploadSource(
    params: Adapter.UploadFileParams,
): { url: string } | { blob: Blob; filename: string } {
    const sources = [params.url, params.path, params.data].filter(value => value !== undefined);
    if (sources.length !== 1) {
        throw FacebookMessengerError.invalid("upload_file 必须且只能提供 url、path、data 之一");
    }
    if (params.path) {
        throw new FacebookMessengerError("Messenger upload_file 不读取宿主本地路径", {
            code: "FACEBOOK_MESSENGER_LOCAL_PATH_REJECTED",
        });
    }
    if (params.url) {
        if (!URL.canParse(params.url)) {
            throw FacebookMessengerError.invalid("upload_file.url 不是有效 URL");
        }
        const url = new URL(params.url);
        if (url.protocol !== "https:" || url.username || url.password) {
            throw FacebookMessengerError.invalid("upload_file.url 必须是无凭据 HTTPS URL");
        }
        return { url: url.toString() };
    }
    const raw = params.data || "";
    const match = raw.match(/^data:([^;,]+);base64,(.*)$/su);
    const encoded = match ? match[2] : raw;
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
        throw FacebookMessengerError.invalid("upload_file.data 不是有效 base64");
    }
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw FacebookMessengerError.invalid("upload_file.data 必须介于 1 byte 与 25 MiB");
    }
    return {
        blob: new Blob([bytes], { type: match?.[1] || contentType(params.name) }),
        filename: params.name,
    };
}

export function messengerAttachmentType(filename: string): "image" | "video" | "audio" | "file" {
    const mime = contentType(filename);
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
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
            pdf: "application/pdf",
            txt: "text/plain",
        }[extension || ""] || "application/octet-stream"
    );
}
