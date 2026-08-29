import { materializeMediaSource, type CommonTypes, type MediaSourceInput } from "onebots";
import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";

export type WeComMediaType = "image" | "voice" | "video" | "file";

const MEDIA_LIMITS: Record<WeComMediaType, number> = {
    image: 2 * 1024 * 1024,
    voice: 2 * 1024 * 1024,
    video: 10 * 1024 * 1024,
    file: 20 * 1024 * 1024,
};

/** 将通用媒体来源上传为企业微信三天有效的临时素材。 */
export async function uploadWeComMedia(
    client: Pick<WeComClient, "uploadTemporaryMedia">,
    type: WeComMediaType,
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
        throw WeComApiError.wrap(error, "WECOM_MEDIA_UPLOAD_ERROR");
    }
}

/** 上传尚未绑定 media_id 的媒体段，随后交给同步编译器保持原始段顺序。 */
export async function prepareWeComMediaSegments(
    client: Pick<WeComClient, "uploadTemporaryMedia">,
    segments: readonly (CommonTypes.Segment | string)[],
): Promise<Array<CommonTypes.Segment | string>> {
    return Promise.all(
        segments.map(async segment => {
            if (typeof segment === "string") return segment;
            const type = weComMediaType(segment.type);
            if (!type) return segment;
            const mediaId = existingMediaId(segment.data);
            const input = mediaInput(segment.data, Boolean(mediaId));
            if (mediaId && input) invalid(`${segment.type} 段不能同时提供 media_id 与媒体来源`);
            if (mediaId) return segment;
            if (!input) return segment;
            const uploadedId = await uploadWeComMedia(client, type, input);
            return { ...segment, data: { ...segment.data, media_id: uploadedId } };
        }),
    );
}

export function weComMediaType(type: string): WeComMediaType | undefined {
    if (type === "image" || type === "video" || type === "file") return type;
    return type === "voice" || type === "audio" || type === "record" ? "voice" : undefined;
}

function mediaInput(
    data: Record<string, unknown>,
    fileIsMediaId: boolean,
): MediaSourceInput | undefined {
    const candidates = [
        stringCandidate("url", data.url),
        stringCandidate("path", data.path),
        stringCandidate("src", data.src),
        stringCandidate("data", data.data),
        fileIsMediaId ? undefined : stringCandidate("file", data.file),
    ].filter(candidate => candidate !== undefined);
    if (candidates.length > 1) invalid("媒体段必须且只能提供一种来源");
    const candidate = candidates[0];
    if (!candidate) return undefined;
    return {
        source: candidate.kind === "data" ? asBase64Source(candidate.value) : candidate.value,
        filename: firstString(data.filename, data.name),
        contentType: firstString(data.content_type, data.mime_type, data.mime),
    };
}

function stringCandidate(
    kind: "url" | "path" | "src" | "data" | "file",
    value: unknown,
): { kind: typeof kind; value: string } | undefined {
    return typeof value === "string" && value ? { kind, value } : undefined;
}

function existingMediaId(data: Record<string, unknown>): string | undefined {
    const direct = firstString(data.media_id);
    if (direct) return direct;
    const file = firstString(data.file);
    if (!file) return undefined;
    if (file.startsWith("wecom://media/")) return file.slice("wecom://media/".length) || undefined;
    return /^[\w-]+$/u.test(file) ? file : undefined;
}

function assertMedia(type: WeComMediaType, data: Uint8Array, contentType: string): void {
    if (data.byteLength <= 5) invalid("临时素材必须大于 5 字节");
    if (data.byteLength > MEDIA_LIMITS[type]) {
        invalid(`${type} 临时素材超过 ${MEDIA_LIMITS[type] / 1024 / 1024}MB 限制`);
    }
    if (type === "image" && contentType !== "image/jpeg" && contentType !== "image/png") {
        invalid("图片临时素材仅支持 JPG 或 PNG");
    }
    if (type === "voice" && contentType !== "audio/amr") {
        invalid("语音临时素材仅支持 AMR");
    }
    if (type === "video" && contentType !== "video/mp4") {
        invalid("视频临时素材仅支持 MP4");
    }
}

function asBase64Source(value: string): string {
    return /^(?:base64:\/\/|data:)/u.test(value) ? value : `base64://${value}`;
}

function firstString(...values: unknown[]): string | undefined {
    return values.find(value => typeof value === "string" && value.length > 0) as
        | string
        | undefined;
}

function invalid(message: string): never {
    throw new WeComApiError(`企业微信 ${message}`, { code: "WECOM_INVALID_MEDIA" });
}
