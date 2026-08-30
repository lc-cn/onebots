import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { WECOM_COLLABORATION_ACTIONS } from "./collaboration-actions.js";

describe("企业微信协作办公动作", () => {
    it.each([
        ["create_calendar", "/cgi-bin/oa/calendar/add"],
        ["delete_schedule_attendees", "/cgi-bin/oa/schedule/del_attendees"],
        ["list_approval_numbers", "/cgi-bin/oa/getapprovalinfo"],
    ] as const)("%s 保持官方请求体并调用 %s", async (action, path) => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = { call } as unknown as WeComClient;
        const request = { marker: action };

        await WECOM_COLLABORATION_ACTIONS[action](client, { request });

        expect(call).toHaveBeenCalledWith({ method: "POST", path, body: request });
        expect(call.mock.calls[0]?.[0].body).not.toBe(request);
    });
});
