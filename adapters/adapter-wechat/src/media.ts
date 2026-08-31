import { materializeMediaSource, type CommonTypes, type MediaSourceInput } from "onebots";
import type { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";

export type WechatMediaType = "image" | "voice" | "video" | "thumb";

const MEDIA_LIMITS: Record<WechatMediaType, number> = {
    image: 10 * 1024 * 1024,
    voice: 2 * 1024 * 1024,
    video: 10 * 1024 * 1024,
    thumb: 64 * 1024,
};

/** 将通用来源上传为当前公众号可用的临时素材。 */
export async function uploadWechatMedia(
    client: Pick<WechatClient, "uploadTemporaryMedia">,
    type: WechatMediaType,
    input: MediaSourceInput,
): Promise<string> {
    try {
        const media = await materializeMediaSource(input);
        assertMedia(type, media.data, media.contentType);
        const result = await client.uploadTemporaryMedia(
            type,
            new Blob([new Uint8Array(media.data)], { type: media.contentType }),
            media.filename,
        );
        return result.media_id;
    } catch (error) {
        throw WechatApiError.wrap(error, "WECHAT_MEDIA_UPLOAD_ERROR");
    }
}

/** 为图片、语音和视频补齐 media_id；视频缩略图使用独立 thumb 素材。 */
export async function prepareWechatMediaSegments(
    client: Pick<WechatClient, "uploadTemporaryMedia">,
    segments: readonly (CommonTypes.Segment | string)[],
): Promise<Array<CommonTypes.Segment | string>> {
    return Promise.all(
        segments.map(async segment => {
            if (typeof segment === "string") return segment;
            const type = messageMediaType(segment.type);
            if (!type) return segment;
            const data = { ...segment.data };
            if (!existingMediaId(data)) {
                const source = sourceInput(data);
                if (!source) return segment;
                data.media_id = await uploadWechatMedia(client, type, source);
            }
            if (type === "video" && !stringValue(data.thumb_media_id)) {
                const thumb = thumbInput(data);
                if (thumb) data.thumb_media_id = await uploadWechatMedia(client, "thumb", thumb);
            }
            return { ...segment, data };
        }),
    );
}

export function messageMediaType(type: string): "image" | "voice" | "video" | undefined {
    if (type === "image" || type === "video") return type;
    return type === "voice" || type === "audio" || type === "record" ? "voice" : undefined;
}

function sourceInput(data: Record<string, unknown>): MediaSourceInput | undefined {
    const candidates = [
        candidate("url", data.url),
        candidate("path", data.path),
        candidate("src", data.src),
        candidate("data", data.data),
        existingMediaId(data) ? undefined : candidate("file", data.file),
    ].filter(value => value !== undefined);
    if (candidates.length > 1) invalid("媒体段必须且只能提供一种外部来源");
    const source = candidates[0];
    if (!source) return undefined;
    return {
        source: source.kind === "data" ? asBase64Source(source.value) : source.value,
        filename: stringValue(data.filename) || stringValue(data.name),
        contentType:
            stringValue(data.content_type) || stringValue(data.mime_type) || stringValue(data.mime),
    };
}

function thumbInput(data: Record<string, unknown>): MediaSourceInput | undefined {
    const direct = stringValue(data.thumb_url) || stringValue(data.thumb_path);
    const encoded = stringValue(data.thumb_data);
    const generic = stringValue(data.thumb);
    const sources = [direct, encoded, generic].filter(value => value !== undefined);
    if (sources.length > 1) invalid("视频只能提供一种缩略图来源");
    const source = sources[0];
    if (!source) return undefined;
    return {
        source: encoded === source ? asBase64Source(source) : source,
        filename: stringValue(data.thumb_filename) || "thumbnail.jpg",
        contentType: stringValue(data.thumb_content_type),
    };
}

function existingMediaId(data: Record<string, unknown>): string | undefined {
    const direct = stringValue(data.media_id) || stringValue(data.file_id);
    if (direct) return direct;
    const file = stringValue(data.file);
    if (!file) return undefined;
    if (file.startsWith("wechat://media/"))
        return file.slice("wechat://media/".length) || undefined;
    return /^[\w-]+$/u.test(file) ? file : undefined;
}

function assertMedia(type: WechatMediaType, data: Uint8Array, contentType: string): void {
    if (!data.byteLength) invalid("临时素材不能为空");
    if (data.byteLength > MEDIA_LIMITS[type]) {
        invalid(`${type} 临时素材超过 ${MEDIA_LIMITS[type] / 1024}KB 限制`);
    }
    if (type === "thumb" && contentType !== "image/jpeg") invalid("缩略图仅支持 JPG");
    if (type === "video" && contentType !== "video/mp4") invalid("视频仅支持 MP4");
}

function candidate(
    kind: "url" | "path" | "src" | "data" | "file",
    value: unknown,
): { kind: typeof kind; value: string } | undefined {
    return typeof value === "string" && value ? { kind, value } : undefined;
}

function asBase64Source(value: string): string {
    return /^(?:base64:\/\/|data:)/u.test(value) ? value : `base64://${value}`;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function invalid(message: string): never {
    throw new WechatApiError(`微信公众号 ${message}`, { code: "WECHAT_INVALID_MEDIA" });
}
