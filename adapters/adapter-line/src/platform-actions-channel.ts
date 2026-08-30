import {
    acquireChatControlRequest,
    createLiffRequest,
    detachModuleRequest,
    missionStickerRequest,
    moduleLimit,
    requireAuthorizationCodeGrant,
    requireRedirectUri,
    updateLiffRequest,
} from "./channel-action-params.js";
import { optionalString, requireString } from "./platform-action-params.js";
import { lineAction, type LineActionHandler } from "./platform-action-context.js";

/** Profile、群聊、LIFF、Module 与 Shop 的官方动作。 */
export const LINE_CHANNEL_ACTIONS = {
    get_profile: lineAction(["user_id"], async ({ client }, params) =>
        client.getProfile(requireString(params, "user_id")),
    ),
    get_group_summary: lineAction(["group_id"], async ({ client }, params) =>
        client.getGroupSummary(requireString(params, "group_id")),
    ),
    get_group_member_count: lineAction(["group_id"], async ({ client }, params) =>
        client.getGroupMemberCount(requireString(params, "group_id")),
    ),
    get_group_member_profile: lineAction(["group_id", "user_id"], async ({ client }, params) =>
        client.getGroupMemberProfile(
            requireString(params, "group_id"),
            requireString(params, "user_id"),
        ),
    ),
    get_group_member_ids: lineAction(["group_id", "start"], async ({ client }, params) =>
        client.getGroupMembersIds(
            requireString(params, "group_id"),
            optionalString(params, "start"),
        ),
    ),
    leave_room: lineAction(["room_id"], async ({ client }, params) =>
        client.leaveRoom(requireString(params, "room_id")),
    ),
    create_liff_app: lineAction(["request"], async ({ client }, params) =>
        client.addLIFFApp(createLiffRequest(params)),
    ),
    list_liff_apps: lineAction([], async ({ client }) => client.getAllLIFFApps()),
    update_liff_app: lineAction(["liff_id", "request"], async ({ client }, params) =>
        client.updateLIFFApp(requireString(params, "liff_id"), updateLiffRequest(params)),
    ),
    delete_liff_app: lineAction(["liff_id"], async ({ client }, params) =>
        client.deleteLIFFApp(requireString(params, "liff_id")),
    ),
    acquire_chat_control: lineAction(["chat_id", "request"], async ({ client }, params) =>
        client.acquireChatControl(
            requireString(params, "chat_id"),
            acquireChatControlRequest(params),
        ),
    ),
    release_chat_control: lineAction(["chat_id"], async ({ client }, params) =>
        client.releaseChatControl(requireString(params, "chat_id")),
    ),
    list_modules: lineAction(["start", "limit"], async ({ client }, params) =>
        client.getModules(optionalString(params, "start"), moduleLimit(params)),
    ),
    attach_module: lineAction(
        [
            "grant_type",
            "code",
            "redirect_uri",
            "code_verifier",
            "client_id",
            "client_secret",
            "region",
            "basic_search_id",
            "scope",
            "brand_type",
        ],
        async ({ client }, params) =>
            client.attachModule(
                requireAuthorizationCodeGrant(params),
                requireString(params, "code"),
                requireRedirectUri(params),
                optionalString(params, "code_verifier"),
                optionalString(params, "client_id"),
                optionalString(params, "client_secret"),
                optionalString(params, "region"),
                optionalString(params, "basic_search_id"),
                optionalString(params, "scope"),
                optionalString(params, "brand_type"),
            ),
    ),
    detach_module: lineAction(["request"], async ({ client }, params) =>
        client.detachModule(detachModuleRequest(params)),
    ),
    mission_sticker: lineAction(["request"], async ({ client }, params) =>
        client.missionStickerV3(missionStickerRequest(params)),
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;
