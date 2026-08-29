import type { PlatformActionHandler } from "onebots";
import type { LineBot } from "./bot.js";

export type LineActionParams = Readonly<Record<string, unknown>>;

/** LINE 原生动作共享 bot 语义入口和官方 SDK 客户端。 */
export interface LineActionContext {
    readonly bot: LineBot;
    readonly client: ReturnType<LineBot["getClient"]>;
}

export type LineActionHandler = PlatformActionHandler<LineActionContext>;
