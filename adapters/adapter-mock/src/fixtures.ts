import type { MockConfig, MockGroup, MockUser } from "./types.js";
import { cloneMockGroup } from "./runtime.js";

export interface MockDataset {
    friends: MockUser[];
    groups: MockGroup[];
}

/** 创建与实例隔离的初始数据集，避免测试之间共享可变 fixture。 */
export function createMockDataset(config: MockConfig): MockDataset {
    const friends = config.friends ?? [
        { user_id: "10001", nickname: "测试好友1", avatar: "https://via.placeholder.com/100" },
        { user_id: "10002", nickname: "测试好友2", avatar: "https://via.placeholder.com/100" },
        { user_id: "10003", nickname: "测试好友3", avatar: "https://via.placeholder.com/100" },
    ];
    const groups =
        config.groups ??
        ([
            {
                group_id: "100001",
                group_name: "测试群1",
                member_count: 50,
                max_member_count: 200,
                members: [
                    { user_id: "10001", nickname: "群主", role: "owner", card: "大佬" },
                    { user_id: "10002", nickname: "管理员", role: "admin" },
                    { user_id: "10003", nickname: "普通成员", role: "member" },
                ],
            },
            {
                group_id: "100002",
                group_name: "测试群2",
                member_count: 100,
                max_member_count: 500,
                members: [{ user_id: config.account_id, nickname: "机器人", role: "member" }],
            },
        ] satisfies MockGroup[]);

    return {
        friends: friends.map(friend => ({ ...friend })),
        groups: groups.map(cloneMockGroup),
    };
}
