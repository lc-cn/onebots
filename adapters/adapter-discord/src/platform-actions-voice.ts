import type { PlatformActionHandler } from "onebots";
import type { DiscordBot } from "./bot.js";
import { DiscordError } from "./errors.js";
import {
    optionalString,
    requireObject,
    requireSnowflake,
    type DiscordActionParams,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<DiscordBot>;

/** Discord 语音频道状态与 Soundboard 资源动作。 */
export const DISCORD_VOICE_ACTIONS = {
    set_voice_channel_status: setVoiceChannelStatus,
    send_soundboard_sound: restAction(
        params => `/channels/${requireSnowflake(params, "channel_id")}/send-soundboard-sound`,
        { method: "POST", body: "sound" },
    ),
    list_default_soundboard_sounds: restAction(() => "/soundboard-default-sounds"),
    list_guild_soundboard_sounds: restAction(params => soundboardPath(params)),
    get_guild_soundboard_sound: restAction(params =>
        soundboardPath(params, requireSnowflake(params, "sound_id")),
    ),
    create_guild_soundboard_sound: restAction(params => soundboardPath(params), {
        method: "POST",
        body: "sound",
        audit: true,
    }),
    update_guild_soundboard_sound: restAction(
        params => soundboardPath(params, requireSnowflake(params, "sound_id")),
        { method: "PATCH", body: "sound", audit: true },
    ),
    delete_guild_soundboard_sound: restAction(
        params => soundboardPath(params, requireSnowflake(params, "sound_id")),
        { method: "DELETE", audit: true },
    ),
} satisfies Readonly<Record<string, Handler>>;

interface RestActionOptions {
    method?: "POST" | "PATCH" | "DELETE";
    body?: string;
    audit?: boolean;
}

function restAction(
    path: (params: DiscordActionParams) => string,
    options: RestActionOptions = {},
): Handler {
    return async (bot, params) =>
        bot.getREST().request(path(params), {
            method: options.method,
            body: options.body ? requireObject(params, options.body) : undefined,
            reason: options.audit ? optionalString(params, "reason") : undefined,
        });
}

async function setVoiceChannelStatus(
    bot: DiscordBot,
    params: DiscordActionParams,
): Promise<unknown> {
    const status = params.status;
    if (status !== null && (typeof status !== "string" || status.length > 500)) {
        throw DiscordError.invalid(
            "Discord 语音频道状态必须为 null 或不超过 500 字符的字符串",
            "DISCORD_ACTION_PARAMS_INVALID",
        );
    }
    return bot
        .getREST()
        .request(`/channels/${requireSnowflake(params, "channel_id")}/voice-status`, {
            method: "PUT",
            body: { status },
            reason: optionalString(params, "reason"),
        });
}

function soundboardPath(params: DiscordActionParams, soundId?: string): string {
    const path = `/guilds/${requireSnowflake(params, "guild_id")}/soundboard-sounds`;
    return soundId ? `${path}/${soundId}` : path;
}
