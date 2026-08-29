import { WechatApiError } from "./errors.js";
import type { WechatUser, WechatUserList } from "./types.js";

interface WechatDirectoryClient {
    getUserList(nextOpenid?: string): Promise<WechatUserList>;
    batchGetUserInfo(openids: string[]): Promise<WechatUser[]>;
}

/** 完整读取已关注用户，并防止异常游标让目录同步永久循环。 */
export async function listWechatFollowers(client: WechatDirectoryClient): Promise<WechatUser[]> {
    const users: WechatUser[] = [];
    const observedOpenids = new Set<string>();
    const observedCursors = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await client.getUserList(cursor);
        const unseenOpenids = (page.data?.openid || []).filter(openid => {
            if (observedOpenids.has(openid)) return false;
            observedOpenids.add(openid);
            return true;
        });
        const profiles = await client.batchGetUserInfo(unseenOpenids);
        users.push(...profiles.filter(user => user.subscribe === 1));

        const next = page.next_openid || undefined;
        if (next && (next === cursor || observedCursors.has(next))) {
            throw new WechatApiError("微信公众号关注者目录游标未推进", {
                code: "WECHAT_CURSOR_STALLED",
                details: { cursor, next },
            });
        }
        if (cursor) observedCursors.add(cursor);
        cursor = next;
    } while (cursor);
    return users;
}
