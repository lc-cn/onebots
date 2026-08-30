import { describe, expect, it, vi } from "vitest";
import { getDingTalkRobotFileDownloadUrl } from "./robot-files.js";

describe("getDingTalkRobotFileDownloadUrl", () => {
    it("使用账号 Robot Code 兑换临时 HTTPS 下载地址", async () => {
        const callApi = vi.fn().mockResolvedValue({
            downloadUrl: "https://static.dingtalk.com/temp/file.bin?signature=secret",
        });

        await expect(
            getDingTalkRobotFileDownloadUrl(
                { config: { app_key: "robot-1" }, callApi } as never,
                "download-code-1",
            ),
        ).resolves.toEqual({
            downloadUrl: "https://static.dingtalk.com/temp/file.bin?signature=secret",
        });
        expect(callApi).toHaveBeenCalledWith("/v1.0/robot/messageFiles/download", {
            method: "POST",
            body: { downloadCode: "download-code-1", robotCode: "robot-1" },
        });
    });

    it("允许使用事件携带的 Robot Code，并拒绝异常平台响应", async () => {
        const callApi = vi.fn().mockResolvedValue({ downloadUrl: "http://example.com/file" });
        await expect(
            getDingTalkRobotFileDownloadUrl(
                { config: { app_key: "default-robot" }, callApi } as never,
                "download-code-1",
                "event-robot",
            ),
        ).rejects.toMatchObject({ code: "DINGTALK_DOWNLOAD_URL_INVALID" });
        expect(callApi).toHaveBeenCalledWith("/v1.0/robot/messageFiles/download", {
            method: "POST",
            body: { downloadCode: "download-code-1", robotCode: "event-robot" },
        });
    });

    it("拒绝缺失下载地址和空下载码", async () => {
        await expect(
            getDingTalkRobotFileDownloadUrl(
                { config: { app_key: "robot-1" }, callApi: vi.fn() } as never,
                "",
            ),
        ).rejects.toMatchObject({ code: "DINGTALK_DOWNLOAD_CODE_REQUIRED" });
        await expect(
            getDingTalkRobotFileDownloadUrl(
                {
                    config: { app_key: "robot-1" },
                    callApi: vi.fn().mockResolvedValue({}),
                } as never,
                "download-code-1",
            ),
        ).rejects.toMatchObject({ code: "DINGTALK_DOWNLOAD_URL_MISSING" });
    });
});
