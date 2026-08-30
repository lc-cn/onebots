import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import { executeWeComPlatformAction } from "./platform-actions.js";

describe("企业微信通讯录读取动作", () => {
    it("读取详细成员和两种部门成员列表", async () => {
        const getUserInfo = vi.fn().mockResolvedValue({ userid: "member-1" });
        const listDepartmentUsers = vi.fn().mockResolvedValue([{ userid: "member-1" }]);
        const call = vi.fn().mockResolvedValue({ userlist: [] });
        const client = { call, getUserInfo, listDepartmentUsers } as unknown as WeComClient;

        await executeWeComPlatformAction(client, "get_user", { user_id: "member-1" });
        await executeWeComPlatformAction(client, "list_department_users", {
            department_id: 2,
            fetch_child: true,
        });
        await executeWeComPlatformAction(client, "list_department_user_ids", {
            department_id: 2,
        });

        expect(getUserInfo).toHaveBeenCalledWith("member-1");
        expect(listDepartmentUsers).toHaveBeenCalledWith(2, true);
        expect(call).toHaveBeenCalledWith({
            path: "/cgi-bin/user/simplelist",
            query: { department_id: 2, fetch_child: 0 },
        });
    });

    it("分页读取全企业成员 ID", async () => {
        const call = vi.fn().mockResolvedValue({ dept_user: [], next_cursor: "next" });
        const client = { call } as unknown as WeComClient;

        await executeWeComPlatformAction(client, "list_user_ids", {
            cursor: "page-2",
            limit: 500,
        });

        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/user/list_id",
            body: { cursor: "page-2", limit: 500 },
        });
    });

    it("提供身份转换、反查和二次验证动作", async () => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = { call } as unknown as WeComClient;

        await executeWeComPlatformAction(client, "convert_user_id_to_open_id", {
            user_id: "member-1",
        });
        await executeWeComPlatformAction(client, "convert_open_id_to_user_id", {
            open_id: "openid-1",
        });
        await executeWeComPlatformAction(client, "get_user_id_by_mobile", {
            mobile: "+8613800000000",
        });
        await executeWeComPlatformAction(client, "get_user_id_by_email", {
            email: "member@example.test",
            email_type: 2,
        });
        await executeWeComPlatformAction(client, "complete_user_secondary_verification", {
            user_id: "member-1",
        });

        expect(call.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/cgi-bin/user/convert_to_openid",
                    body: { userid: "member-1" },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/user/convert_to_userid",
                    body: { openid: "openid-1" },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/user/getuserid",
                    body: { mobile: "+8613800000000" },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/user/get_userid_by_email",
                    body: { email: "member@example.test", email_type: 2 },
                },
            ],
            [
                {
                    path: "/cgi-bin/user/authsucc",
                    query: { userid: "member-1" },
                },
            ],
        ]);
    });

    it("区分部门详情、完整树和直属子部门 ID", async () => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = { call } as unknown as WeComClient;

        await executeWeComPlatformAction(client, "get_department", { department_id: 2 });
        await executeWeComPlatformAction(client, "list_departments", {});
        await executeWeComPlatformAction(client, "list_child_department_ids", {
            department_id: 2,
        });

        expect(call.mock.calls).toEqual([
            [{ path: "/cgi-bin/department/get", query: { id: 2 } }],
            [{ path: "/cgi-bin/department/list", query: { id: undefined } }],
            [{ path: "/cgi-bin/department/simplelist", query: { id: 2 } }],
        ]);
    });

    it("拒绝无效分页、部门 ID 和契约外参数", async () => {
        const client = { call: vi.fn() } as unknown as WeComClient;

        await expect(
            executeWeComPlatformAction(client, "list_user_ids", { limit: 10_001 }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        await expect(
            executeWeComPlatformAction(client, "get_department", { department_id: 1.5 }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        await expect(
            executeWeComPlatformAction(client, "get_user", {
                user_id: "member-1",
                userid: "typo",
            }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<WeComApiError>>({
                code: "WECOM_UNEXPECTED_ACTION_PARAMETER",
            }),
        );
    });
});
