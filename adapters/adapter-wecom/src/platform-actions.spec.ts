import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { executeWeComPlatformAction, WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("企业微信平台动作", () => {
    it("应用群聊使用 appchat 原生 API", async () => {
        const sendAppChatMessage = vi.fn().mockResolvedValue("m1");
        const client = { sendAppChatMessage } as unknown as WeComClient;
        await executeWeComPlatformAction(client, "send_appchat_message", {
            chat_id: "chat1",
            message: { msgtype: "text", text: { content: "hi" } },
        });
        expect(sendAppChatMessage).toHaveBeenCalledWith(
            "chat1",
            expect.objectContaining({ msgtype: "text" }),
        );
    });

    it("公开通讯录、媒体和通用 API 能力", () => {
        expect(WECOM_PLATFORM_ACTIONS.has("create_appchat")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("upload_temporary_media")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("batch_get_external_contacts")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("list_external_contact_groups")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("add_group_welcome_template")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("create_calendar")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("create_schedule")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_approval_detail")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("wecom_call")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("wecom_directory_call")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("upload_directory_file")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("sync_users_from_directory_file")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("replace_users_from_directory_file")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("replace_departments_from_directory_file")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_directory_import_result")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_oauth_user_identity")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("sign_agent_jsapi_config")).toBe(true);
    });

    it("通讯录写入和异步导入只走独立凭据作用域", async () => {
        const callDirectory = vi.fn().mockResolvedValue({ errcode: 0, jobid: "job-1" });
        const client = { callDirectory } as unknown as WeComClient;
        await executeWeComPlatformAction(client, "create_user", {
            user: { userid: "member-1", name: "成员" },
        });
        await executeWeComPlatformAction(client, "sync_users_from_directory_file", {
            media_id: "csv-1",
            invite: false,
            callback: { url: "https://callback.example.test" },
        });
        await executeWeComPlatformAction(client, "get_directory_import_result", {
            job_id: "job-1",
        });
        expect(callDirectory.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/cgi-bin/user/create",
                    body: { userid: "member-1", name: "成员" },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/cgi-bin/batch/syncuser",
                    body: {
                        media_id: "csv-1",
                        to_invite: false,
                        callback: { url: "https://callback.example.test" },
                    },
                },
            ],
            [
                {
                    path: "/cgi-bin/batch/getresult",
                    query: { jobid: "job-1" },
                },
            ],
        ]);
    });
});
