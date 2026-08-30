import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { executeWeComPlatformAction } from "./platform-actions.js";

function mockClient() {
    const call = vi.fn().mockResolvedValue({ errcode: 0 });
    return { client: { call } as unknown as WeComClient, call };
}

describe("企业微信客户联系动作", () => {
    it("批量获取客户使用官方路径并闭合分页参数", async () => {
        const { client, call } = mockClient();
        await executeWeComPlatformAction(client, "batch_get_external_contacts", {
            user_ids: ["zhangsan", "lisi"],
            cursor: "next",
            limit: 50,
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/externalcontact/batch/get_by_user",
            body: { userid_list: ["zhangsan", "lisi"], cursor: "next", limit: 50 },
        });
    });

    it("客户群列表保留官方筛选结构并补齐默认页长", async () => {
        const { client, call } = mockClient();
        await executeWeComPlatformAction(client, "list_external_contact_groups", {
            request: { status_filter: 0, owner_filter: { userid_list: ["zhangsan"] } },
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/externalcontact/groupchat/list",
            body: {
                status_filter: 0,
                owner_filter: { userid_list: ["zhangsan"] },
                limit: 100,
            },
        });
    });

    it("客户群详情默认请求群成员姓名", async () => {
        const { client, call } = mockClient();
        await executeWeComPlatformAction(client, "get_external_contact_group", {
            chat_id: "wr-group",
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/externalcontact/groupchat/get",
            body: { chat_id: "wr-group", need_name: 1 },
        });
    });

    it("联系方式和群欢迎语使用各自官方端点", async () => {
        const { client, call } = mockClient();
        await executeWeComPlatformAction(client, "add_contact_way", {
            contact_way: { type: 1, scene: 2, user: ["zhangsan"] },
        });
        await executeWeComPlatformAction(client, "delete_group_welcome_template", {
            template_id: "template-1",
        });
        expect(call.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/cgi-bin/externalcontact/add_contact_way",
                    body: { type: 1, scene: 2, user: ["zhangsan"] },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/externalcontact/group_welcome_template/del",
                    body: { template_id: "template-1" },
                },
            ],
        ]);
    });

    it("在发出请求前拒绝越界分页和空成员列表", async () => {
        const { client, call } = mockClient();
        await expect(
            executeWeComPlatformAction(client, "batch_get_external_contacts", {
                user_ids: [],
            }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        await expect(
            executeWeComPlatformAction(client, "list_external_contact_groups", {
                request: { limit: 1001 },
            }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        expect(call).not.toHaveBeenCalled();
    });
});
