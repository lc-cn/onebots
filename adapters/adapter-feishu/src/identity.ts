import type { FeishuUser } from "./types.js";

/** 解析飞书机器人的平台身份；配置 account_id 只是 OneBots 本地账号别名。 */
export function resolveFeishuBotId(
    user: Pick<FeishuUser, "open_id" | "user_id"> | null | undefined,
    appId: string,
): string {
    return user?.open_id || user?.user_id || appId;
}
