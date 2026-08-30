import {
    definePlatformActionHandlers,
    type PlatformActionHandler,
    type PlatformActionParameterMap,
} from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

type WhatsAppActionHandlers = Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/**
 * 闭合一个 WhatsApp 动作域的顶层参数契约，同时保留精确 action 联合类型。
 *
 * 各领域模块只声明业务 handler 与允许字段；未知字段的错误码和上下文由这里统一。
 */
export function defineWhatsAppActionHandlers<const THandlers extends WhatsAppActionHandlers>(
    handlers: THandlers,
    parameters: PlatformActionParameterMap<THandlers>,
): THandlers {
    return definePlatformActionHandlers(
        handlers,
        parameters,
        (action, parameter) =>
            new WhatsAppApiError(`WhatsApp 动作 ${action} 不接受参数 ${parameter}`, {
                code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
                details: { action, parameter },
            }),
    );
}
