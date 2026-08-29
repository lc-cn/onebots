import { describe, expect, it, vi } from "vitest";
import { WeComKfClient } from "./client.js";
import { executeWeComKfPlatformAction, WECOM_KF_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { WeComKfConfig } from "./types.js";

const config: WeComKfConfig = {
    account_id: "kf",
    corp_id: "ww-corp",
    corp_secret: "secret",
    token: "token",
    encoding_aes_key: Buffer.alloc(32, 1).toString("base64").slice(0, 43),
};

describe("微信客服平台动作", () => {
    it("公开账号、接待人员、会话、统计与底层 API", () => {
        for (const action of [
            "wecom_kf_call",
            "list_kf_accounts",
            "add_servicers",
            "transfer_service_state",
            "get_customers",
            "get_corp_statistic",
        ])
            expect(WECOM_KF_PLATFORM_ACTIONS.has(action)).toBe(true);
    });

    it("接待人员动作使用官方字段", async () => {
        const client = new WeComKfClient(config);
        const call = vi.spyOn(client, "call").mockResolvedValue({ errcode: 0, errmsg: "ok" });
        await executeWeComKfPlatformAction(client, "add_servicers", {
            open_kfid: "wk-1",
            user_ids: ["u1"],
            department_ids: [2],
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/kf/servicer/add",
            body: { open_kfid: "wk-1", userid_list: ["u1"], department_id_list: [2] },
        });
    });

    it.each([
        "https://evil.example",
        "//evil.example/path",
        "/cgi-bin/kf/../gettoken",
        "/cgi-bin/kf/%2e%2e/gettoken",
        "/cgi-bin/kf/account/list?limit=1",
        "/cgi-bin/kf/account/list#fragment",
    ])("拒绝越权或夹带 URL 语义的路径: %s", async path => {
        const client = new WeComKfClient(config);
        await expect(
            executeWeComKfPlatformAction(client, "wecom_kf_call", {
                path,
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
    });

    it("拒绝空接待人员集合", async () => {
        const client = new WeComKfClient(config);
        await expect(
            executeWeComKfPlatformAction(client, "add_servicers", { open_kfid: "wk-1" }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
    });
});
