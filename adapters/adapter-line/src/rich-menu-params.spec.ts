import { describe, expect, it, vi } from "vitest";
import { lineAction } from "./platform-action-context.js";
import {
    requireRichMenuAlias,
    richMenuBulkLinkRequest,
    richMenuBulkUnlinkRequest,
    richMenuImage,
} from "./rich-menu-params.js";

describe("LINE Rich Menu 参数", () => {
    it("只接受官方图片媒体类型与大小", async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
        const image = richMenuImage({
            data_base64: png.toString("base64"),
            content_type: "image/png",
        });
        expect(image.type).toBe("image/png");
        await expect(image.arrayBuffer()).resolves.toEqual(
            png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        );

        expect(() =>
            richMenuImage({ data_base64: "aGVsbG8=", content_type: "image/webp" }),
        ).toThrow("只能是 image/png 或 image/jpeg");
        expect(() =>
            richMenuImage({
                data_base64: Buffer.concat([
                    Buffer.from([0xff, 0xd8, 0xff]),
                    Buffer.alloc(999_998),
                ]).toString("base64"),
                content_type: "image/jpeg",
            }),
        ).toThrow("不能超过 1 MB");
        expect(() =>
            richMenuImage({
                data_base64: Buffer.from("not-a-png").toString("base64"),
                content_type: "image/png",
            }),
        ).toThrow("内容与 content_type 不匹配");
    });

    it("按官方字符集闭合 Rich Menu alias", () => {
        expect(requireRichMenuAlias({ alias_id: "menu_tab-1" })).toBe("menu_tab-1");
        expect(() => requireRichMenuAlias({ alias_id: "Menu Tab" })).toThrow("1 到 32 位小写字母");
        expect(() => requireRichMenuAlias({ alias_id: "a".repeat(33) })).toThrow(
            "1 到 32 位小写字母",
        );
    });

    it("闭合批量关联与解除关联请求", () => {
        expect(
            richMenuBulkLinkRequest({
                request: { richMenuId: "rich-1", userIds: ["U1", "U2"] },
            }),
        ).toEqual({ richMenuId: "rich-1", userIds: ["U1", "U2"] });
        expect(richMenuBulkUnlinkRequest({ request: { userIds: ["U1"] } })).toEqual({
            userIds: ["U1"],
        });
        expect(() =>
            richMenuBulkLinkRequest({
                request: { richMenuId: "rich-1", userIds: ["U1"], typo: true },
            }),
        ).toThrow("不接受参数 typo");
        expect(() => richMenuBulkUnlinkRequest({ request: { userIds: ["U1", "U1"] } })).toThrow(
            "不能重复",
        );
        expect(() =>
            richMenuBulkUnlinkRequest({
                request: { userIds: Array.from({ length: 501 }, (_, index) => `U${index}`) },
            }),
        ).toThrow("不能超过 500");
    });

    it("共用动作包装器先拒绝未知外层字段", async () => {
        const handler = vi.fn(async () => ({ ok: true }));
        const action = lineAction(["rich_menu_id"], handler);
        const context = { bot: {}, client: {} };
        await expect(
            action(context as never, { rich_menu_id: "rich-1", typo: true }),
        ).rejects.toMatchObject({ code: "LINE_INVALID_ACTION_PARAMS" });
        expect(handler).not.toHaveBeenCalled();
    });
});
