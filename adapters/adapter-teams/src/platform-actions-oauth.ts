import type { PlatformActionHandler } from "onebots";
import type { TeamsBot } from "./bot.js";
import {
    optionalString,
    requireString,
    stringArray,
    withConversation,
    type TeamsActionParams,
} from "./platform-action-params.js";

/** Azure Bot OAuth token 生命周期动作。 */
export const TEAMS_OAUTH_ACTIONS = {
    get_user_token: (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.users.getToken({
                userId: requireString(params.user_id, "user_id"),
                connectionName: requireString(params.connection_name, "connection_name"),
                channelId: optionalString(params.channel_id),
                code: optionalString(params.code),
            }),
        ),
    get_user_aad_tokens: (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.users.getAadTokens({
                userId: requireString(params.user_id, "user_id"),
                connectionName: requireString(params.connection_name, "connection_name"),
                channelId: optionalString(params.channel_id) || "msteams",
                resourceUrls: stringArray(params.resource_urls, "resource_urls"),
            }),
        ),
    get_user_token_status: (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.users.getTokenStatus({
                userId: requireString(params.user_id, "user_id"),
                channelId: optionalString(params.channel_id) || "msteams",
                includeFilter: requireString(params.include_filter, "include_filter"),
            }),
        ),
    sign_out_user: (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.users.signOut({
                userId: requireString(params.user_id, "user_id"),
                connectionName: requireString(params.connection_name, "connection_name"),
                channelId: optionalString(params.channel_id) || "msteams",
            }),
        ),
    exchange_user_token: (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.users.exchangeToken({
                userId: requireString(params.user_id, "user_id"),
                connectionName: requireString(params.connection_name, "connection_name"),
                channelId: optionalString(params.channel_id) || "msteams",
                exchangeRequest: {
                    uri: optionalString(params.uri),
                    token: requireString(params.token, "token"),
                },
            }),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<TeamsBot>>>;
