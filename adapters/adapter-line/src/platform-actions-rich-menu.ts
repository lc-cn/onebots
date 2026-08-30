import type { messagingApi } from "@line/bot-sdk";
import {
    couponStatuses,
    optionalPositiveInteger,
    optionalString,
    requireRecord,
    requireString,
    streamResult,
} from "./platform-action-params.js";
import { lineAction, type LineActionHandler } from "./platform-action-context.js";
import {
    requireRichMenuAlias,
    richMenuBulkLinkRequest,
    richMenuBulkUnlinkRequest,
    richMenuImage,
} from "./rich-menu-params.js";

/** Rich Menu、别名、批处理与 Coupon 原生动作。 */
export const LINE_RICH_MENU_ACTIONS = {
    create_rich_menu: lineAction(["rich_menu"], async ({ client }, params) =>
        client.createRichMenu(requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest),
    ),
    get_rich_menu: lineAction(["rich_menu_id"], async ({ client }, params) =>
        client.getRichMenu(requireString(params, "rich_menu_id")),
    ),
    list_rich_menus: lineAction([], async ({ client }) => client.getRichMenuList()),
    delete_rich_menu: lineAction(["rich_menu_id"], async ({ client }, params) =>
        client.deleteRichMenu(requireString(params, "rich_menu_id")),
    ),
    set_rich_menu_image: lineAction(
        ["rich_menu_id", "data_base64", "content_type"],
        async ({ client }, params) =>
            client.setRichMenuImage(requireString(params, "rich_menu_id"), richMenuImage(params)),
    ),
    get_rich_menu_image: lineAction(["rich_menu_id"], async ({ client }, params) =>
        streamResult(await client.getRichMenuImage(requireString(params, "rich_menu_id"))),
    ),
    validate_rich_menu: lineAction(["rich_menu"], async ({ client }, params) =>
        client.validateRichMenuObject(
            requireRecord(params, "rich_menu") as messagingApi.RichMenuRequest,
        ),
    ),
    get_default_rich_menu: lineAction([], async ({ client }) => client.getDefaultRichMenuId()),
    set_default_rich_menu: lineAction(["rich_menu_id"], async ({ client }, params) =>
        client.setDefaultRichMenu(requireString(params, "rich_menu_id")),
    ),
    cancel_default_rich_menu: lineAction([], async ({ client }) => client.cancelDefaultRichMenu()),
    link_rich_menu_to_user: lineAction(["user_id", "rich_menu_id"], async ({ client }, params) =>
        client.linkRichMenuIdToUser(
            requireString(params, "user_id"),
            requireString(params, "rich_menu_id"),
        ),
    ),
    unlink_rich_menu_from_user: lineAction(["user_id"], async ({ client }, params) =>
        client.unlinkRichMenuIdFromUser(requireString(params, "user_id")),
    ),
    get_user_rich_menu: lineAction(["user_id"], async ({ client }, params) =>
        client.getRichMenuIdOfUser(requireString(params, "user_id")),
    ),
    link_rich_menu_to_users: lineAction(["request"], async ({ client }, params) =>
        client.linkRichMenuIdToUsers(richMenuBulkLinkRequest(params)),
    ),
    unlink_rich_menu_from_users: lineAction(["request"], async ({ client }, params) =>
        client.unlinkRichMenuIdFromUsers(richMenuBulkUnlinkRequest(params)),
    ),
    create_rich_menu_alias: lineAction(["alias_id", "rich_menu_id"], async ({ client }, params) =>
        client.createRichMenuAlias({
            richMenuAliasId: requireRichMenuAlias(params),
            richMenuId: requireString(params, "rich_menu_id"),
        }),
    ),
    get_rich_menu_alias: lineAction(["alias_id"], async ({ client }, params) =>
        client.getRichMenuAlias(requireRichMenuAlias(params)),
    ),
    list_rich_menu_aliases: lineAction([], async ({ client }) => client.getRichMenuAliasList()),
    update_rich_menu_alias: lineAction(["alias_id", "rich_menu_id"], async ({ client }, params) =>
        client.updateRichMenuAlias(requireRichMenuAlias(params), {
            richMenuId: requireString(params, "rich_menu_id"),
        }),
    ),
    delete_rich_menu_alias: lineAction(["alias_id"], async ({ client }, params) =>
        client.deleteRichMenuAlias(requireRichMenuAlias(params)),
    ),
    rich_menu_batch: lineAction(["request"], async ({ client }, params) =>
        client.richMenuBatch(requireRecord(params, "request") as messagingApi.RichMenuBatchRequest),
    ),
    validate_rich_menu_batch: lineAction(["request"], async ({ client }, params) =>
        client.validateRichMenuBatchRequest(
            requireRecord(params, "request") as messagingApi.RichMenuBatchRequest,
        ),
    ),
    get_rich_menu_batch_progress: lineAction(["request_id"], async ({ client }, params) =>
        client.getRichMenuBatchProgress(requireString(params, "request_id")),
    ),
    create_coupon: lineAction(["coupon"], async ({ client }, params) =>
        client.createCoupon(requireRecord(params, "coupon") as messagingApi.CouponCreateRequest),
    ),
    get_coupon: lineAction(["coupon_id"], async ({ client }, params) =>
        client.getCouponDetail(requireString(params, "coupon_id")),
    ),
    list_coupons: lineAction(["status", "start", "limit"], async ({ client }, params) =>
        client.listCoupon(
            couponStatuses(params),
            optionalString(params, "start"),
            optionalPositiveInteger(params, "limit"),
        ),
    ),
    close_coupon: lineAction(["coupon_id"], async ({ client }, params) =>
        client.closeCoupon(requireString(params, "coupon_id")),
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;
