import { materializeMediaSource, type PlatformActionHandler } from "onebots";
import { exactParams, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

const EMOJI_UPLOAD_FIELDS = ["emoji_name", "file", "filename", "content_type"] as const;
const EMOJI_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

export const ZULIP_EMOJI_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "upload_custom_emoji",
    "deactivate_custom_emoji",
]);

/** Zulip 组织 Custom Emoji 资源动作。 */
export const ZULIP_EMOJI_ACTION_HANDLERS = {
    get_custom_emoji: (client, params) => {
        exactParams(params, []);
        return client.call("realm/emoji");
    },
    upload_custom_emoji: async (client, params) => {
        const input = exactParams(params, EMOJI_UPLOAD_FIELDS, ["emoji_name", "file"]);
        const emojiName = requireEmojiName(input.emoji_name);
        const media = await materializeMediaSource({
            source: requireString(input.file, "file"),
            filename: optionalString(input.filename),
            contentType: optionalString(input.content_type),
        });
        if (!EMOJI_CONTENT_TYPES.has(media.contentType)) {
            throw new ZulipError("Zulip 自定义表情仅支持 PNG、JPEG 或 GIF", {
                code: "ZULIP_INVALID_EMOJI_CONTENT_TYPE",
                details: { content_type: media.contentType },
            });
        }
        return client.uploadCustomEmoji(emojiName, media.data, media.filename, media.contentType);
    },
    deactivate_custom_emoji: (client, params) => {
        const input = exactParams(params, ["emoji_name"], ["emoji_name"]);
        return client.call(
            `realm/emoji/${encodeURIComponent(requireEmojiName(input.emoji_name))}`,
            "DELETE",
        );
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function requireEmojiName(value: unknown): string {
    const name = requireString(value, "emoji_name").trim();
    if (!/^[A-Za-z0-9 _-]+$/u.test(name)) {
        throw new ZulipError("Zulip emoji_name 只能包含字母、数字、空格、下划线和连字符", {
            code: "ZULIP_INVALID_EMOJI_NAME",
        });
    }
    return name;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}
