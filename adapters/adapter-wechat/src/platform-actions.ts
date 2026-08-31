import { definePlatformActions } from "onebots";
import type { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";
import type { WechatActionParams } from "./platform-action-context.js";
import { WECHAT_AUDIENCE_ACTIONS } from "./platform-actions-audience.js";
import { WECHAT_CONTENT_ACTIONS } from "./platform-actions-content.js";
import { WECHAT_CUSTOMER_SERVICE_ACTIONS } from "./platform-actions-customer-service.js";
import { WECHAT_MESSAGING_ACTIONS } from "./platform-actions-messaging.js";

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...WECHAT_MESSAGING_ACTIONS,
        ...WECHAT_AUDIENCE_ACTIONS,
        ...WECHAT_CONTENT_ACTIONS,
        ...WECHAT_CUSTOMER_SERVICE_ACTIONS,
    },
    action =>
        new WechatApiError(`未知微信公众号平台动作: ${action}`, {
            code: "WECHAT_UNKNOWN_ACTION",
        }),
);

export const WECHAT_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type WechatPlatformAction =
    typeof WECHAT_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 显式覆盖常用公众号接口，并以 wechat_call 承接微信新增 API。 */
export function executeWechatPlatformAction(
    client: WechatClient,
    action: string,
    params: WechatActionParams,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}
