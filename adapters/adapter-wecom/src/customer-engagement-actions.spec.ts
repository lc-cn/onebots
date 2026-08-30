import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { executeWeComPlatformAction, WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("企业微信客户经营动作", () => {
    it.each([
        ["mark_external_contact_tags", "/cgi-bin/externalcontact/mark_tag", "request"],
        [
            "create_external_contact_mass_message",
            "/cgi-bin/externalcontact/add_msg_template",
            "message",
        ],
        ["create_external_contact_moment", "/cgi-bin/externalcontact/add_moment_task", "moment"],
        [
            "add_external_contact_group_join_way",
            "/cgi-bin/externalcontact/groupchat/add_join_way",
            "join_way",
        ],
        [
            "get_external_contact_group_statistics",
            "/cgi-bin/externalcontact/groupchat/statistic",
            "request",
        ],
    ])("%s 调用官方 POST 端点", async (action, path, parameter) => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = { call } as unknown as WeComClient;
        await executeWeComPlatformAction(client, action, {
            [parameter]: { marker: action },
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path,
            body: { marker: action },
        });
    });

    it("能力集合公开全部客户经营域", () => {
        expect(WECOM_PLATFORM_ACTIONS.has("list_external_contact_tags")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_external_contact_mass_message_result")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_external_contact_moment_send_result")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("delete_external_contact_group_join_way")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("get_external_contact_group_daily_statistics")).toBe(
            true,
        );
    });
});
