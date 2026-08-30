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

describe("Zulip 本人资料动作", () => {
    it("覆盖本人资料查询、更新与清除", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_own_user", {});
        await executeZulipPlatformAction(client, "update_own_profile_data", {
            data: [
                { id: 4, value: "maintainer" },
                { id: 5, value: [12, 13] },
                { id: 6, value: null },
            ],
        });
        await executeZulipPlatformAction(client, "remove_own_profile_data", { data: [4, 6] });

        expect(call).toHaveBeenNthCalledWith(1, "users/me");
        expect(call).toHaveBeenNthCalledWith(2, "users/me/profile_data", "PATCH", {
            data: [
                { id: 4, value: "maintainer" },
                { id: 5, value: [12, 13] },
                { id: 6, value: null },
            ],
        });
        expect(call).toHaveBeenNthCalledWith(3, "users/me/profile_data", "DELETE", {
            data: [4, 6],
        });
    });

    it("使用统一媒体来源上传头像并删除头像", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        const upload = vi
            .spyOn(client, "uploadOwnAvatar")
            .mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "upload_own_avatar", {
            file: "data:image/png;base64,iVBORw0KGgo=",
            filename: "avatar.png",
        });
        await executeZulipPlatformAction(client, "delete_own_avatar", {});

        expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), "avatar.png", "image/png");
        expect(call).toHaveBeenCalledWith("users/me/avatar", "DELETE");
    });

    it.each([
        ["get_own_user", { unexpected: true }],
        ["update_own_profile_data", { data: [{ id: 4 }] }],
        ["update_own_profile_data", { data: [{ id: 4, value: true }] }],
        ["remove_own_profile_data", { data: [4, "6"] }],
        ["upload_own_avatar", {}],
        ["delete_own_avatar", { unexpected: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        const upload = vi.spyOn(client, "uploadOwnAvatar");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toBeInstanceOf(
            Error,
        );
        expect(call).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });
});
