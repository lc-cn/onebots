import type { messagingApi } from "@line/bot-sdk";
import {
    base64Blob,
    couponStatuses,
    optionalNumber,
    optionalString,
    requireRecord,
    requireString,
    streamResult,
} from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** Rich Menu、别名、批处理与 Coupon 原生动作。 */
export const LINE_RICH_MENU_ACTIONS = {
    create_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createRichMenu(requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest),
    get_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRichMenu(requireString(params, "rich_menu_id")),
    list_rich_menus: async ({ client }: LineActionContext) => client.getRichMenuList(),
    delete_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.deleteRichMenu(requireString(params, "rich_menu_id")),
    set_rich_menu_image: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.setRichMenuImage(requireString(params, "rich_menu_id"), base64Blob(params)),
    get_rich_menu_image: async ({ client }: LineActionContext, params: LineActionParams) =>
        streamResult(await client.getRichMenuImage(requireString(params, "rich_menu_id"))),
    validate_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateRichMenuObject(
            requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest,
        ),
    get_default_rich_menu: async ({ client }: LineActionContext) => client.getDefaultRichMenuId(),
    set_default_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.setDefaultRichMenu(requireString(params, "rich_menu_id")),
    cancel_default_rich_menu: async ({ client }: LineActionContext) =>
        client.cancelDefaultRichMenu(),
    link_rich_menu_to_user: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.linkRichMenuIdToUser(
            requireString(params, "user_id"),
            requireString(params, "rich_menu_id"),
        ),
    unlink_rich_menu_from_user: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.unlinkRichMenuIdFromUser(requireString(params, "user_id")),
    get_user_rich_menu: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRichMenuIdOfUser(requireString(params, "user_id")),
    link_rich_menu_to_users: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.linkRichMenuIdToUsers(
            requireRecord(params, "request") as messagingApi.RichMenuBulkLinkRequest,
        ),
    unlink_rich_menu_from_users: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.unlinkRichMenuIdFromUsers(
            requireRecord(params, "request") as messagingApi.RichMenuBulkUnlinkRequest,
        ),
    create_rich_menu_alias: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createRichMenuAlias({
            richMenuAliasId: requireString(params, "alias_id"),
            richMenuId: requireString(params, "rich_menu_id"),
        }),
    get_rich_menu_alias: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRichMenuAlias(requireString(params, "alias_id")),
    list_rich_menu_aliases: async ({ client }: LineActionContext) => client.getRichMenuAliasList(),
    update_rich_menu_alias: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.updateRichMenuAlias(requireString(params, "alias_id"), {
            richMenuId: requireString(params, "rich_menu_id"),
        }),
    delete_rich_menu_alias: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.deleteRichMenuAlias(requireString(params, "alias_id")),
    rich_menu_batch: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.richMenuBatch(requireRecord(params, "request") as messagingApi.RichMenuBatchRequest),
    validate_rich_menu_batch: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.validateRichMenuBatchRequest(
            requireRecord(params, "request") as messagingApi.RichMenuBatchRequest,
        ),
    get_rich_menu_batch_progress: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getRichMenuBatchProgress(requireString(params, "request_id")),
    create_coupon: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createCoupon(
            params.coupon
                ? (requireRecord(params, "coupon") as messagingApi.CouponCreateRequest)
                : undefined,
        ),
    get_coupon: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getCouponDetail(requireString(params, "coupon_id")),
    list_coupons: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.listCoupon(
            couponStatuses(params),
            optionalString(params, "start"),
            optionalNumber(params, "limit"),
        ),
    close_coupon: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.closeCoupon(requireString(params, "coupon_id")),
} satisfies Readonly<Record<string, LineActionHandler>>;
