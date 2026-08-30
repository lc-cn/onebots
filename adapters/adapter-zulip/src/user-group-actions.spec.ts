import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { executeZulipPlatformAction } from "./platform-actions.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip 用户组动作", () => {
    it("创建用户组并保留当前官方权限字段", async () => {
        const { client, call } = mockClient();
        const params = {
            name: "maintainers",
            description: "Maintainers",
            members: [1, 2],
            subgroups: [3],
            can_manage_group: { direct_members: [1], direct_subgroups: [] },
        };

        await executeZulipPlatformAction(client, "create_user_group", params);

        expect(call).toHaveBeenCalledWith("user_groups/create", "POST", params);
    });

    it("使用独立路径管理成员、子组和成员关系查询", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "update_user_group_members", {
            user_group_id: 38,
            add: [12, 13],
            delete_subgroups: [9],
        });
        await executeZulipPlatformAction(client, "update_user_group_subgroups", {
            user_group_id: 38,
            add: [9],
        });
        await executeZulipPlatformAction(client, "get_user_group_membership", {
            user_group_id: 38,
            user_id: 12,
            direct_member_only: true,
        });

        expect(call).toHaveBeenNthCalledWith(1, "user_groups/38/members", "POST", {
            add: [12, 13],
            delete_subgroups: [9],
        });
        expect(call).toHaveBeenNthCalledWith(2, "user_groups/38/subgroups", "POST", {
            add: [9],
        });
        expect(call).toHaveBeenNthCalledWith(3, "user_groups/38/members/12", "GET", {
            direct_member_only: true,
        });
    });

    it("停用用户组不转发路径字段", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "deactivate_user_group", {
            user_group_id: "38",
        });

        expect(call).toHaveBeenCalledWith("user_groups/38/deactivate", "POST");
    });

    it("更新用户组使用官方 new/old 权限结构", async () => {
        const { client, call } = mockClient();
        const permission = {
            new: { direct_members: [10], direct_subgroups: [11] },
            old: 12,
        };

        await executeZulipPlatformAction(client, "update_user_group", {
            user_group_id: 38,
            can_manage_group: permission,
            deactivated: false,
        });

        expect(call).toHaveBeenCalledWith("user_groups/38", "PATCH", {
            can_manage_group: permission,
            deactivated: false,
        });
    });

    it("拒绝未知字段、空更新和非法成员数组", async () => {
        const { client } = mockClient();

        await expect(
            executeZulipPlatformAction(client, "create_user_group", {
                name: "team",
                description: "Team",
                members: [],
                legacy_permission: 1,
            }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_ACTION_PARAM" });
        await expect(
            executeZulipPlatformAction(client, "update_user_group", { user_group_id: 38 }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_ACTION_PARAM" });
        await expect(
            executeZulipPlatformAction(client, "update_user_group_members", {
                user_group_id: 38,
                add: ["12"],
            }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_ACTION_PARAM" });
        await expect(
            executeZulipPlatformAction(client, "update_user_group", {
                user_group_id: 38,
                can_manage_group: { new: { direct_members: [1], legacy: [] } },
            }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_ACTION_PARAM" });
    });
});

function mockClient() {
    const client = new ZulipClient(config, { transport: async () => ({}) });
    const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
    return { client, call };
}
