import { materializeMediaSource, type MaterializedMedia, type MediaSourceInput } from "onebots";
import { DiscordError } from "./errors.js";

/** Discord 待上传附件；source 支持 HTTP(S)、data URL、base64:// 和 Node.js 本地路径。 */
export interface DiscordFileInput extends MediaSourceInput {
    description?: string;
}

/** 已物化、可直接写入 multipart 的 Discord 附件。 */
export interface DiscordUpload extends MaterializedMedia {
    description?: string;
}

/** 将统一媒体来源收敛为字节与可信元数据。 */
export async function materializeDiscordFile(input: DiscordFileInput): Promise<DiscordUpload> {
    try {
        const media = await materializeMediaSource(input);
        const description = optionalDescription(input.description);
        return {
            ...media,
            ...(description ? { description } : {}),
        };
    } catch (error) {
        throw DiscordError.wrap(error, "DISCORD_MEDIA_INVALID");
    }
}

function optionalDescription(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (value.length > 1024) throw invalidSource("附件描述不能超过 1024 个字符");
    return value;
}

function invalidSource(message: string): DiscordError {
    return DiscordError.invalid(`Discord 媒体来源无效: ${message}`, "DISCORD_MEDIA_INVALID");
}
