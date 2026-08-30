import type { liff, moduleOperation, shop } from "@line/bot-sdk";
import {
    optionalNumber,
    optionalString,
    requireRecord,
    requireString,
} from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** Profile、群聊、LIFF、Module 与 Shop 的官方动作。 */
export const LINE_CHANNEL_ACTIONS = {
    get_profile: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getProfile(requireString(params, "user_id")),
    get_group_summary: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getGroupSummary(requireString(params, "group_id")),
    get_group_member_count: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getGroupMemberCount(requireString(params, "group_id")),
    get_group_member_profile: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getGroupMemberProfile(
            requireString(params, "group_id"),
            requireString(params, "user_id"),
        ),
    get_group_member_ids: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getGroupMembersIds(
            requireString(params, "group_id"),
            optionalString(params, "start"),
        ),
    leave_room: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.leaveRoom(requireString(params, "room_id")),
    create_liff_app: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.addLIFFApp(requireRecord(params, "request") as liff.AddLiffAppRequest),
    list_liff_apps: async ({ client }: LineActionContext) => client.getAllLIFFApps(),
    update_liff_app: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.updateLIFFApp(
            requireString(params, "liff_id"),
            requireRecord(params, "request") as liff.UpdateLiffAppRequest,
        ),
    delete_liff_app: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.deleteLIFFApp(requireString(params, "liff_id")),
    acquire_chat_control: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.acquireChatControl(
            requireString(params, "chat_id"),
            params.request
                ? (requireRecord(params, "request") as moduleOperation.AcquireChatControlRequest)
                : undefined,
        ),
    release_chat_control: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.releaseChatControl(requireString(params, "chat_id")),
    list_modules: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getModules(optionalString(params, "start"), optionalNumber(params, "limit")),
    attach_module: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.attachModule(
            requireString(params, "grant_type"),
            requireString(params, "code"),
            requireString(params, "redirect_uri"),
            optionalString(params, "code_verifier"),
            optionalString(params, "client_id"),
            optionalString(params, "client_secret"),
            optionalString(params, "region"),
            optionalString(params, "basic_search_id"),
            optionalString(params, "scope"),
            optionalString(params, "brand_type"),
        ),
    detach_module: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.detachModule(
            params.request
                ? (requireRecord(params, "request") as moduleOperation.DetachModuleRequest)
                : undefined,
        ),
    mission_sticker: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.missionStickerV3(requireRecord(params, "request") as shop.MissionStickerRequest),
} satisfies Readonly<Record<string, LineActionHandler>>;
