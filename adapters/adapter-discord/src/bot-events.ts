import type { DiscordError } from "./errors.js";
import type {
    DiscordApiGuild,
    DiscordInteraction,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
    DiscordGuildDeleteData,
    DiscordGuildMemberRemoveData,
} from "./types.js";
import type { DiscordMember, DiscordMessage, DiscordUser } from "./bot-model.js";
import type { DiscordWebhookEventPayload } from "./lite/webhook-events.js";

/** DiscordBot 对外公开的强类型事件契约。 */
export interface DiscordBotEvents {
    ready: [user: DiscordUser];
    stopped: [];
    resumed: [];
    reconnecting: [error: DiscordError];
    client_error: [error: DiscordError];
    close: [code: number, reason: string];
    dispatch: [eventName: string, data: unknown, sequence: number | null, sessionId: string | null];
    messageCreate: [message: DiscordMessage];
    messageUpdate: [previous: null, message: DiscordMessageUpdateData];
    messageDelete: [data: DiscordMessageDeleteData];
    guildCreate: [guild: DiscordApiGuild];
    guildDelete: [guild: DiscordGuildDeleteData];
    guildMemberAdd: [member: DiscordMember];
    guildMemberRemove: [member: DiscordGuildMemberRemoveData];
    interactionCreate: [interaction: DiscordInteraction];
    webhookEvent: [payload: DiscordWebhookEventPayload];
}
