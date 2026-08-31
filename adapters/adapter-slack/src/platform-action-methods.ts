import type { PlatformActionHandler } from "onebots";
import type { SlackBot } from "./bot.js";

/** 将经审计的动作名映射为固定 Web API method，调用方不能覆盖 method。 */
export function createSlackMethodHandlers(
    methods: Readonly<Record<string, string>>,
): Readonly<Record<string, PlatformActionHandler<SlackBot>>> {
    return Object.fromEntries(
        Object.entries(methods).map(([action, method]) => [
            action,
            (bot: SlackBot, params: Readonly<Record<string, unknown>>) =>
                bot.call(method, { ...params }),
        ]),
    );
}
