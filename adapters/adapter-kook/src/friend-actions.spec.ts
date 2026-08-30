import { describe, expect, test, vi } from "vitest";
import { KookFriendActions } from "./friend-actions.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value),
});

describe("KOOK 好友动作", () => {
    test("投影好友目录并只返回收到的待处理申请", async () => {
        const callApi = vi
            .fn()
            .mockResolvedValueOnce({
                friend: [relation(1, "friend", "user-1", "Alice", false)],
            })
            .mockResolvedValueOnce({
                request: [
                    relation(2, "request", "user-2", "Bob", false),
                    relation(3, "request", "user-3", "Carol", true),
                ],
            });
        const actions = new KookFriendActions(createId);
        const bot = { callApi } as never;

        await expect(actions.getFriendList(bot)).resolves.toEqual([
            {
                user_id: createId("user-1"),
                user_name: "Alice",
                remark: "Alice nick",
            },
        ]);
        await expect(actions.getFriendRequests(bot)).resolves.toEqual([
            expect.objectContaining({
                request_id: createId(2),
                user_id: createId("user-2"),
                user_name: "Bob nick",
                time: 0,
                state: "pending",
                initiator_uid: "user-2",
            }),
        ]);
    });

    test("删除好友后可继续屏蔽，并在拒绝申请时使用平台申请 ID", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const actions = new KookFriendActions(createId);
        const bot = { callApi } as never;

        await actions.deleteFriend(bot, "user-1", true);
        await actions.handleFriendRequest(bot, {
            flag: "42",
            approve: false,
            block: true,
            initiator_uid: "user-2",
        });

        expect(callApi.mock.calls).toEqual([
            ["/v3/friend/delete", { method: "POST", body: { user_id: "user-1" } }],
            ["/v3/friend/block", { method: "POST", body: { user_id: "user-1" } }],
            ["/v3/friend/handle-request", { method: "POST", body: { id: 42, accept: false } }],
            ["/v3/friend/block", { method: "POST", body: { user_id: "user-2" } }],
        ]);
    });

    test("拒绝伪造关系响应和平台无法表达的申请参数", async () => {
        const actions = new KookFriendActions(createId);
        await expect(
            actions.getFriendList({
                callApi: vi.fn().mockResolvedValue({ friend: [{}] }),
            } as never),
        ).rejects.toMatchObject({ code: "KOOK_FRIEND_RESPONSE_INVALID" });
        await expect(
            actions.handleFriendRequest({ callApi: vi.fn() } as never, {
                flag: "42",
                approve: false,
                reason: "spam",
            }),
        ).rejects.toMatchObject({ code: "KOOK_FRIEND_REQUEST_COMMENT_UNSUPPORTED" });
    });
});

function relation(
    id: number,
    type: "friend" | "request",
    userId: string,
    username: string,
    own: boolean,
): Record<string, unknown> {
    return {
        id,
        type,
        own,
        friend_info: {
            id: userId,
            username,
            nickname: `${username} nick`,
        },
    };
}
