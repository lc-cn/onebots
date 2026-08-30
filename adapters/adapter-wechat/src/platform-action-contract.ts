import { definePlatformActionHandlers } from "onebots";
import { WechatApiError } from "./errors.js";
import type { WechatActionHandler } from "./platform-action-context.js";

type WechatActionHandlers = Readonly<Record<string, WechatActionHandler>>;

/**
 * 闭合微信公众号命名动作的顶层参数。
 *
 * 复杂的微信原生 payload 仍作为单个对象参数无损传递；只有 `wechat_call` 可以接收低层
 * 调用字段。这样既不会限制微信持续演进，也不会让命名动作中的拼写错误被静默忽略。
 */
export function defineWechatActionContract<const THandlers extends WechatActionHandlers>(
    handlers: THandlers,
    parameterKeys: { readonly [TAction in keyof THandlers]: readonly string[] },
): THandlers {
    return definePlatformActionHandlers(
        handlers,
        parameterKeys,
        (action, parameter) =>
            new WechatApiError(`微信公众号动作 ${action} 不接受参数 ${parameter}`, {
                code: "WECHAT_ACTION_PARAM_UNKNOWN",
                details: { action, parameter },
            }),
    );
}
