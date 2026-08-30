import { requireString } from "./platform-action-params.js";
import { lineAction, type LineActionHandler } from "./platform-action-context.js";

/** Channel Access Token API；应用凭据只从配置读取，不接受动作参数覆盖。 */
export const LINE_CHANNEL_TOKEN_ACTIONS = {
    issue_short_lived_channel_token: lineAction([], async ({ channelToken }) =>
        channelToken.issueShortLived(),
    ),
    issue_stateless_channel_token: lineAction([], async ({ channelToken }) =>
        channelToken.issueStatelessByClientSecret(),
    ),
    issue_channel_token_v2_1: lineAction(["client_assertion"], async ({ channelToken }, params) =>
        channelToken.issueV21(requireString(params, "client_assertion")),
    ),
    issue_stateless_channel_token_by_jwt: lineAction(
        ["client_assertion"],
        async ({ channelToken }, params) =>
            channelToken.issueStatelessByJwt(requireString(params, "client_assertion")),
    ),
    list_channel_token_key_ids_v2_1: lineAction(
        ["client_assertion"],
        async ({ channelToken }, params) =>
            channelToken.listV21KeyIds(requireString(params, "client_assertion")),
    ),
    verify_channel_token: lineAction(["access_token"], async ({ channelToken }, params) =>
        channelToken.verify(requireString(params, "access_token")),
    ),
    verify_channel_token_v2_1: lineAction(["access_token"], async ({ channelToken }, params) =>
        channelToken.verifyV21(requireString(params, "access_token")),
    ),
    revoke_channel_token: lineAction(["access_token"], async ({ channelToken }, params) =>
        channelToken.revoke(requireString(params, "access_token")),
    ),
    revoke_channel_token_v2_1: lineAction(["access_token"], async ({ channelToken }, params) =>
        channelToken.revokeV21(requireString(params, "access_token")),
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;
