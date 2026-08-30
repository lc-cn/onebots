import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppGraphApi } from "./graph-api.js";

export const WHATSAPP_MEDIA_ACTIONS = Object.freeze([
    "upload_media",
    "get_media",
    "download_media",
    "delete_media",
] as const);
export type WhatsAppMediaAction = (typeof WHATSAPP_MEDIA_ACTIONS)[number];

export interface WhatsAppMediaUploadResponse {
    id: string;
}

/** Meta 返回的临时下载凭据；url 通常仅在五分钟内有效。 */
export interface WhatsAppMediaInfo {
    messaging_product: "whatsapp";
    url: string;
    mime_type: string;
    sha256: string;
    file_size: string;
    id: string;
}

export interface WhatsAppMediaDownload {
    info: WhatsAppMediaInfo;
    data: Buffer;
}

export interface WhatsAppMediaDeleteResponse {
    success: true;
}

const MIB = 1024 * 1024;
/** Meta Cloud API 当前支持的 MIME 类型及字节上限。 */
export const WHATSAPP_MEDIA_LIMITS = Object.freeze({
    "audio/aac": 16 * MIB,
    "audio/mp4": 16 * MIB,
    "audio/mpeg": 16 * MIB,
    "audio/amr": 16 * MIB,
    "audio/ogg": 16 * MIB,
    "text/plain": 100 * MIB,
    "application/pdf": 100 * MIB,
    "application/vnd.ms-powerpoint": 100 * MIB,
    "application/msword": 100 * MIB,
    "application/vnd.ms-excel": 100 * MIB,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 100 * MIB,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": 100 * MIB,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 100 * MIB,
    "image/jpeg": 5 * MIB,
    "image/png": 5 * MIB,
    // Meta 对动画 Sticker 允许到 500 KiB；静态约束更低，由服务端继续校验。
    "image/webp": 500 * 1024,
    "video/mp4": 16 * MIB,
    "video/3gpp": 16 * MIB,
});
export type WhatsAppMediaMimeType = keyof typeof WHATSAPP_MEDIA_LIMITS;

export function isWhatsAppMediaMimeType(value: string): value is WhatsAppMediaMimeType {
    return Object.hasOwn(WHATSAPP_MEDIA_LIMITS, value);
}

export function isWhatsAppMediaAction(action: string): action is WhatsAppMediaAction {
    return (WHATSAPP_MEDIA_ACTIONS as readonly string[]).includes(action);
}

/** Phone Number 级媒体资产入口；统一上传约束、所有权校验和临时 URL 下载。 */
export class WhatsAppMedia {
    constructor(
        private readonly client: WhatsAppClient,
        private readonly graph: WhatsAppGraphApi,
    ) {}

    async upload(
        file: Blob,
        mimeType: WhatsAppMediaMimeType,
        filename = "upload",
    ): Promise<WhatsAppMediaUploadResponse> {
        const type = mediaType(mimeType);
        validateFile(file, type);
        const form = new FormData();
        form.set("messaging_product", "whatsapp");
        form.set("file", file, fileName(filename));
        return uploadResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/media`,
                body: form,
            }),
        );
    }

    async get(mediaId: string): Promise<WhatsAppMediaInfo> {
        return mediaInfo(
            await this.client.call<unknown>({
                resource: resourceId(mediaId),
                query: { phone_number_id: this.client.config.phone_number_id },
            }),
        );
    }

    async download(mediaId: string, signal?: AbortSignal): Promise<WhatsAppMediaDownload> {
        const info = await this.get(mediaId);
        return { info, data: await this.downloadFrom(info, signal) };
    }

    /** 下载已经查询过的临时 URL，避免一次业务动作重复获取元数据。 */
    downloadFrom(media: WhatsAppMediaInfo, signal?: AbortSignal): Promise<Buffer> {
        const info = mediaInfo(media);
        return this.graph.download(info.url, info.id, signal);
    }

    async delete(mediaId: string): Promise<WhatsAppMediaDeleteResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "DELETE",
                resource: resourceId(mediaId),
                query: { phone_number_id: this.client.config.phone_number_id },
            }),
        );
    }

    async execute(
        action: WhatsAppMediaAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "upload_media": {
                rejectUnknown(params, ["data", "mime_type", "filename"]);
                const mimeType = mediaType(params.mime_type);
                return this.upload(
                    new Blob([decodeBase64(params.data)], { type: mimeType }),
                    mimeType,
                    params.filename === undefined
                        ? "upload"
                        : inputString(params.filename, "filename"),
                );
            }
            case "get_media":
                rejectUnknown(params, ["media_id"]);
                return this.get(inputString(params.media_id, "media_id"));
            case "download_media": {
                rejectUnknown(params, ["media_id"]);
                const result = await this.download(inputString(params.media_id, "media_id"));
                return { ...result.info, data: result.data.toString("base64") };
            }
            case "delete_media":
                rejectUnknown(params, ["media_id"]);
                return this.delete(inputString(params.media_id, "media_id"));
        }
    }
}

export const WHATSAPP_MEDIA_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_MEDIA_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.media.execute(action, params),
    ]),
) as Record<WhatsAppMediaAction, PlatformActionHandler<WhatsAppClient>>;

function validateFile(file: Blob, mimeType: WhatsAppMediaMimeType): void {
    if (!(file instanceof Blob) || file.size === 0) invalidParameter("file 不能为空");
    if (file.type && file.type.toLowerCase() !== mimeType) {
        invalidParameter("file.type 必须与 mime_type 一致");
    }
    if (file.size > WHATSAPP_MEDIA_LIMITS[mimeType]) {
        invalidParameter(`媒体超过 ${mimeType} 的官方大小限制`);
    }
}

function mediaType(value: unknown): WhatsAppMediaMimeType {
    const type = inputString(value, "mime_type").toLowerCase();
    if (!/^[a-z\d][a-z\d!#$&^_.+-]*\/[a-z\d][a-z\d!#$&^_.+-]*$/u.test(type)) {
        invalidParameter("mime_type 必须是有效 MIME 类型");
    }
    if (!isWhatsAppMediaMimeType(type)) {
        invalidParameter(`mime_type 不受 Cloud API 支持: ${type}`);
    }
    return type;
}

function fileName(value: unknown): string {
    const filename = inputString(value, "filename");
    if (filename.length > 255 || /[\u0000-\u001f\u007f/\\]/u.test(filename)) {
        invalidParameter("filename 必须是不含路径和控制字符的文件名，且不超过 255 字符");
    }
    return filename;
}

function resourceId(value: unknown): string {
    const id = inputString(value, "media_id");
    if (!/^[A-Za-z\d._:-]+$/u.test(id)) invalidParameter("media_id 必须是单段 Graph 资源 ID");
    return id;
}

function decodeBase64(value: unknown): ArrayBuffer {
    const data = inputString(value, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data)) {
        invalidParameter("data 必须是标准 Base64");
    }
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length) invalidParameter("data 解码后不能为空");
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
}

function uploadResponse(value: unknown): WhatsAppMediaUploadResponse {
    const source = responseRecord(value, value);
    return { id: responseString(source.id, value) };
}

function mediaInfo(value: unknown): WhatsAppMediaInfo {
    const source = responseRecord(value, value);
    if (source.messaging_product !== "whatsapp") invalidResponse(value);
    const url = responseString(source.url, value);
    if (!URL.canParse(url) || new URL(url).protocol !== "https:") invalidResponse(value);
    const fileSize = responseString(source.file_size, value);
    if (!/^(?:0|[1-9]\d*)$/u.test(fileSize)) invalidResponse(value);
    return {
        messaging_product: "whatsapp",
        url,
        mime_type: responseString(source.mime_type, value),
        sha256: responseString(source.sha256, value),
        file_size: fileSize,
        id: responseString(source.id, value),
    };
}

function successResponse(value: unknown): WhatsAppMediaDeleteResponse {
    const source = responseRecord(value, value);
    if (source.success !== true) invalidResponse(value);
    return { success: true };
}

function inputString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseRecord(value: unknown, root: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(root);
    return value as Record<string, unknown>;
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`Media 参数包含未知字段: ${unknown}`);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Media 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
