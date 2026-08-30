import type { PlatformActionHandler } from "onebots";
import type { LineBot } from "./bot.js";
import { exactParams } from "./platform-action-params.js";

export type LineActionParams = Readonly<Record<string, unknown>>;

/** LINE 原生动作共享 bot 语义入口和官方 SDK 客户端。 */
export interface LineActionContext {
    readonly bot: LineBot;
    readonly client: ReturnType<LineBot["getClient"]>;
    readonly channelToken: ReturnType<LineBot["getChannelTokenClient"]>;
}

export type LineActionHandler = PlatformActionHandler<LineActionContext>;

/**
 * 将动作的外层参数契约与执行入口绑定，避免拼错字段被 SDK 静默忽略。
 * 复杂官方请求体仍由对应领域解析器负责闭合。
 */
export function lineAction(
    fields: readonly string[],
    handler: LineActionHandler,
): LineActionHandler {
    return async (context, params) => {
        exactParams(params, fields);
        return handler(context, params);
    };
}
