import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamsFileConsentManager } from "./file-consent.js";

afterEach(() => vi.unstubAllGlobals());

describe("Teams file consent", () => {
    it("只消费已认证 Activity 携带的上传目标与 file-info 元数据", async () => {
        const request = vi
            .fn()
            .mockResolvedValue(
                new Response(null, { status: 201, headers: { etag: '"file-etag"' } }),
            );
        vi.stubGlobal("fetch", request);
        const sendActivity = vi.fn().mockResolvedValue({ id: "message-1" });
        const manager = new TeamsFileConsentManager(sendActivity);
        manager.capture(consentActivity());

        await expect(
            manager.complete("consent-1", { source: "base64://aGVsbG8=" }),
        ).resolves.toMatchObject({
            upload: { status: 201, etag: '"file-etag"' },
            message: { id: "message-1" },
        });
        expect(request).toHaveBeenCalledWith(
            new URL("https://upload.example.com/session?token=secret"),
            expect.objectContaining({ method: "PUT", body: Buffer.from("hello") }),
        );
        expect(sendActivity).toHaveBeenCalledWith(
            "conversation-1",
            expect.objectContaining({
                attachments: [
                    expect.objectContaining({
                        contentUrl: "https://tenant.sharepoint.com/file.txt",
                        name: "file.txt",
                        content: { uniqueId: "file-1", fileType: "txt" },
                    }),
                ],
            }),
        );
        await expect(
            manager.complete("consent-1", { source: "base64://aGVsbG8=" }),
        ).rejects.toMatchObject({ code: "TEAMS_FILE_CONSENT_NOT_FOUND" });
    });

    it("未见过的 Activity ID 不会触发文件上传", async () => {
        const request = vi.fn();
        vi.stubGlobal("fetch", request);
        const manager = new TeamsFileConsentManager(vi.fn());

        await expect(
            manager.complete("forged", { source: "base64://c2VjcmV0" }),
        ).rejects.toMatchObject({ code: "TEAMS_FILE_CONSENT_NOT_FOUND" });
        expect(request).not.toHaveBeenCalled();
    });

    it("上传成功但回执失败时只重试回执，不重复上传", async () => {
        const request = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
        vi.stubGlobal("fetch", request);
        const sendActivity = vi
            .fn()
            .mockRejectedValueOnce(new Error("temporary"))
            .mockResolvedValueOnce({ id: "message-1" });
        const manager = new TeamsFileConsentManager(sendActivity);
        manager.capture(consentActivity());

        await expect(
            manager.complete("consent-1", { source: "base64://aGVsbG8=" }),
        ).rejects.toThrow("temporary");
        await expect(
            manager.complete("consent-1", { source: "base64://aGVsbG8=" }),
        ).resolves.toMatchObject({ message: { id: "message-1" } });
        expect(request).toHaveBeenCalledOnce();
        expect(sendActivity).toHaveBeenCalledTimes(2);
    });
});

function consentActivity(): Activity {
    const activity = new Activity(ActivityTypes.Invoke);
    activity.id = "consent-1";
    activity.name = "fileConsent/invoke";
    activity.conversation = { id: "conversation-1" };
    activity.value = {
        type: "fileUpload",
        action: "accept",
        uploadInfo: {
            uploadUrl: "https://upload.example.com/session?token=secret",
            contentUrl: "https://tenant.sharepoint.com/file.txt",
            uniqueId: "file-1",
            fileType: "txt",
            name: "file.txt",
        },
    };
    return activity;
}
