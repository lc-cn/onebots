import { afterEach, describe, expect, it, vi } from "vitest";
import { compileFeishuMessage } from "./messages.js";

const client = {
    endpoint: "https://open.feishu.cn/open-apis",
    getTenantAccessToken: vi.fn().mockResolvedValue("tenant-token"),
    invalidateTenantAccessToken: vi.fn(),
};

describe("飞书消息编译器", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("编译文本、真实 mention 和回复", async () => {
        await expect(
            compileFeishuMessage(
                [
                    { type: "text", data: { text: "你好 " } },
                    { type: "at", data: { user_id: "mapped", name: "Ada" } },
                    { type: "reply", data: { message_id: "parent" } },
                ],
                { client, resolveUserId: value => `raw-${value}` },
            ),
        ).resolves.toEqual({
            msgType: "post",
            replyTo: "parent",
            content: {
                zh_cn: {
                    title: "",
                    content: [
                        [
                            { tag: "text", text: "你好 " },
                            { tag: "at", user_id: "raw-mapped", user_name: "Ada" },
                        ],
                    ],
                },
            },
        });
    });

    it("上传图片并在 post 中使用当前应用返回的 image_key", async () => {
        const request = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, data: { image_key: "img_current" } }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", request);

        const result = await compileFeishuMessage(
            [
                { type: "text", data: { text: "截图" } },
                { type: "image", data: { file: "base64://aW1hZ2U=", name: "image.png" } },
            ],
            { client, resolveUserId: String },
        );
        expect(result).toMatchObject({ msgType: "post" });
        expect(result.content).toEqual({
            zh_cn: {
                title: "",
                content: [
                    [
                        { tag: "text", text: "截图" },
                        { tag: "img", image_key: "img_current" },
                    ],
                ],
            },
        });
        expect(request).toHaveBeenCalledWith(
            "https://open.feishu.cn/open-apis/im/v1/images",
            expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
        );
    });

    it("媒体上传遇到失效令牌时刷新并重试一次", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 99991663, msg: "token invalid" })),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 0, data: { image_key: "img_new" } })),
            );
        vi.stubGlobal("fetch", request);
        const getTenantAccessToken = vi
            .fn()
            .mockResolvedValueOnce("old-token")
            .mockResolvedValueOnce("new-token");
        const invalidateTenantAccessToken = vi.fn();

        await expect(
            compileFeishuMessage([{ type: "image", data: { file: "base64://aW1hZ2U=" } }], {
                client: {
                    endpoint: client.endpoint,
                    getTenantAccessToken,
                    invalidateTenantAccessToken,
                },
                resolveUserId: String,
            }),
        ).resolves.toMatchObject({ content: { image_key: "img_new" } });
        expect(invalidateTenantAccessToken).toHaveBeenCalledWith("old-token");
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("已有媒体 key 不重复上传，并拒绝未知或有损组合", async () => {
        await expect(
            compileFeishuMessage([{ type: "image", data: { image_key: "img_known" } }], {
                client,
                resolveUserId: String,
            }),
        ).resolves.toEqual({
            msgType: "image",
            content: { image_key: "img_known" },
            replyTo: undefined,
        });
        await expect(
            compileFeishuMessage([{ type: "unknown", data: {} }], {
                client,
                resolveUserId: String,
            }),
        ).rejects.toThrow("不支持消息段 unknown");
        await expect(
            compileFeishuMessage(
                [
                    { type: "text", data: { text: "附件" } },
                    { type: "file", data: { file_key: "file_known" } },
                ],
                { client, resolveUserId: String },
            ),
        ).rejects.toThrow("无法在单条消息中无损混合");
    });
});
