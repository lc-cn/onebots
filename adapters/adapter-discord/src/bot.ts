import { DiscordBotChannelActions } from "./bot-channel-actions.js";

/** Discord Bot 的稳定外部接口；实现按生命周期、消息、Guild 与频道领域分层。 */
export class DiscordBot extends DiscordBotChannelActions {}

export type {
    DiscordAttachment,
    DiscordChannel,
    DiscordGuild,
    DiscordMember,
    DiscordMessage,
    DiscordUser,
} from "./bot-model.js";

export type { DiscordBotEvents } from "./bot-events.js";
