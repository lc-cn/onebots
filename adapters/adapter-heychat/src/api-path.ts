import { isSafeAbsoluteApiPath } from "onebots";

/** 黑盒语音机器人令牌只允许访问已公开的 chatroom API 命名空间。 */
export function isSafeHeychatApiPath(path: string): boolean {
    return (
        isSafeAbsoluteApiPath(path) &&
        ["/chatroom/v2/", "/chatroom/v3/", "/chatroom/channel/"].some(prefix =>
            path.startsWith(prefix),
        )
    );
}
