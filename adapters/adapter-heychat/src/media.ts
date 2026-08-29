import { materializeMediaSource, type CommonTypes, type MediaSourceInput } from "onebots";
import type { HeychatBot } from "./bot.js";
import { HeychatApiError } from "./errors.js";

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

/** 将任意通用媒体来源上传到黑盒语音 CDN。 */
export async function uploadHeychatMedia(
    bot: Pick<HeychatBot, "uploadMedia">,
    input: MediaSourceInput,
): Promise<string> {
    try {
        const media = await materializeMediaSource(input);
        if (media.data.byteLength > MAX_UPLOAD_SIZE) {
            throw new HeychatApiError("黑盒语音上传文件不能超过 25 MiB", {
                code: "HEYCHAT_INVALID_UPLOAD",
            });
        }
        return await bot.uploadMedia(media.data, media.filename, media.contentType);
    } catch (error) {
        throw HeychatApiError.wrap(error, "HEYCHAT_MEDIA_UPLOAD_ERROR");
    }
}

/** 上传图片段后保留原顺序与图片尺寸元数据。 */
export async function prepareHeychatMediaSegments(
    bot: Pick<HeychatBot, "uploadMedia">,
    segments: readonly CommonTypes.Segment[],
): Promise<CommonTypes.Segment[]> {
    return Promise.all(
        segments.map(async segment => {
            if (segment.type !== "image") return segment;
            const source = uniqueSource(segment.data);
            const url = await uploadHeychatMedia(bot, {
                source,
                filename: stringValue(segment.data.filename) || stringValue(segment.data.name),
                contentType:
                    stringValue(segment.data.content_type) || stringValue(segment.data.mime),
            });
            return { ...segment, data: { ...segment.data, url } };
        }),
    );
}

export function normalizeBase64Source(value: string): string {
    return /^(?:base64:\/\/|data:)/u.test(value) ? value : `base64://${value}`;
}

function uniqueSource(data: Record<string, unknown>): string {
    const values = [data.url, data.path, data.file, data.data]
        .map(stringValue)
        .filter(value => value !== undefined);
    if (values.length !== 1) {
        throw new HeychatApiError("图片消息必须且只能提供 url/path/file/data 之一", {
            code: "HEYCHAT_INVALID_MESSAGE",
        });
    }
    return data.data === values[0] ? normalizeBase64Source(values[0]!) : values[0]!;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}
