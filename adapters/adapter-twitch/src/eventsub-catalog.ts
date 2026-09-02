export type TwitchEventSubConditionProfile =
    | "broadcaster"
    | "chat"
    | "moderator"
    | "raid"
    | "user"
    | "authorization"
    | "conduit"
    | "drop"
    | "extension";

export interface TwitchEventSubDefinition {
    /** Twitch 当前公开且非 Beta 的版本；最后一项是默认版本。 */
    versions: readonly string[];
    condition: TwitchEventSubConditionProfile;
    transports?: readonly ("websocket" | "webhook")[];
    batching?: boolean;
}

const v1 = (
    condition: TwitchEventSubConditionProfile = "broadcaster",
): TwitchEventSubDefinition => ({
    versions: ["1"],
    condition,
});
const v2 = (condition: TwitchEventSubConditionProfile): TwitchEventSubDefinition => ({
    versions: ["2"],
    condition,
});
const v1v2 = (condition: TwitchEventSubConditionProfile): TwitchEventSubDefinition => ({
    versions: ["1", "2"],
    condition,
});

/**
 * 官方稳定 EventSub 目录。
 *
 * Beta 类型不会伪装成稳定能力；未知新类型仍可通过 Client.ingest() 消费，待官方稳定后再进入自动订阅表。
 */
export const TWITCH_EVENTSUB_CATALOG = {
    "automod.message.hold": v1v2("moderator"),
    "automod.message.update": v1v2("moderator"),
    "automod.settings.update": v1("moderator"),
    "automod.terms.update": v1("moderator"),
    "channel.ad_break.begin": v1(),
    "channel.ban": v1(),
    "channel.bits.use": v1(),
    "channel.channel_points_automatic_reward_redemption.add": v1v2("broadcaster"),
    "channel.channel_points_custom_reward.add": v1(),
    "channel.channel_points_custom_reward.remove": v1(),
    "channel.channel_points_custom_reward.update": v1(),
    "channel.channel_points_custom_reward_redemption.add": v1(),
    "channel.channel_points_custom_reward_redemption.update": v1(),
    "channel.charity_campaign.donate": v1(),
    "channel.charity_campaign.progress": v1(),
    "channel.charity_campaign.start": v1(),
    "channel.charity_campaign.stop": v1(),
    "channel.chat.clear": v1("chat"),
    "channel.chat.clear_user_messages": v1("chat"),
    "channel.chat.message": v1("chat"),
    "channel.chat.message_delete": v1("chat"),
    "channel.chat.notification": v1("chat"),
    "channel.chat.user_message_hold": v1("chat"),
    "channel.chat.user_message_update": v1("chat"),
    "channel.chat_settings.update": v1("chat"),
    "channel.cheer": v1(),
    "channel.follow": v2("moderator"),
    "channel.goal.begin": v1(),
    "channel.goal.end": v1(),
    "channel.goal.progress": v1(),
    "channel.hype_train.begin": v1(),
    "channel.hype_train.end": v1(),
    "channel.hype_train.progress": v1(),
    "channel.moderate": v1v2("moderator"),
    "channel.moderator.add": v1(),
    "channel.moderator.remove": v1(),
    "channel.poll.begin": v1(),
    "channel.poll.end": v1(),
    "channel.poll.progress": v1(),
    "channel.prediction.begin": v1(),
    "channel.prediction.end": v1(),
    "channel.prediction.lock": v1(),
    "channel.prediction.progress": v1(),
    "channel.raid": v1("raid"),
    "channel.shared_chat.begin": v1(),
    "channel.shared_chat.end": v1(),
    "channel.shared_chat.update": v1(),
    "channel.shield_mode.begin": v1("moderator"),
    "channel.shield_mode.end": v1("moderator"),
    "channel.shoutout.create": v1("moderator"),
    "channel.shoutout.receive": v1("moderator"),
    "channel.subscribe": v1(),
    "channel.subscription.end": v1(),
    "channel.subscription.gift": v1(),
    "channel.subscription.message": v1(),
    "channel.suspicious_user.message": v1("moderator"),
    "channel.suspicious_user.update": v1("moderator"),
    "channel.unban": v1(),
    "channel.unban_request.create": v1("moderator"),
    "channel.unban_request.resolve": v1("moderator"),
    "channel.update": v2("broadcaster"),
    "channel.vip.add": v1(),
    "channel.vip.remove": v1(),
    "channel.warning.acknowledge": v1("moderator"),
    "channel.warning.send": v1("moderator"),
    "conduit.shard.disabled": v1("conduit"),
    "drop.entitlement.grant": {
        versions: ["1"],
        condition: "drop",
        transports: ["webhook"],
        batching: true,
    },
    "extension.bits_transaction.create": {
        versions: ["1"],
        condition: "extension",
        transports: ["webhook"],
    },
    "stream.offline": v1(),
    "stream.online": v1(),
    "user.authorization.grant": v1("authorization"),
    "user.authorization.revoke": v1("authorization"),
    "user.update": v1("user"),
    "whisper.received": v1("user"),
} as const satisfies Readonly<Record<string, TwitchEventSubDefinition>>;

export const TWITCH_EVENTSUB_TYPES = Object.freeze(
    Object.keys(TWITCH_EVENTSUB_CATALOG),
) as readonly (keyof typeof TWITCH_EVENTSUB_CATALOG)[];

export function getTwitchEventSubDefinition(type: string): TwitchEventSubDefinition | undefined {
    return (TWITCH_EVENTSUB_CATALOG as Readonly<Record<string, TwitchEventSubDefinition>>)[type];
}
