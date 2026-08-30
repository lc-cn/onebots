import type { messagingApi } from "@line/bot-sdk";
import {
    base64Blob,
    exactParams,
    invalidParams,
    requireRecord,
    requireString,
    requireStringArray,
} from "./platform-action-params.js";
import type { LineActionParams } from "./platform-action-context.js";

const RICH_MENU_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_RICH_MENU_IMAGE_BYTES = 1_000_000;

export function richMenuImage(params: LineActionParams): Blob {
    const image = base64Blob(params);
    if (!RICH_MENU_IMAGE_TYPES.has(image.type)) {
        throw invalidParams("LINE Rich Menu 图片 content_type 只能是 image/png 或 image/jpeg");
    }
    if (image.size > MAX_RICH_MENU_IMAGE_BYTES) {
        throw invalidParams("LINE Rich Menu 图片不能超过 1 MB");
    }
    const bytes = Buffer.from(requireString(params, "data_base64"), "base64");
    if (!hasImageSignature(bytes, image.type)) {
        throw invalidParams("LINE Rich Menu 图片内容与 content_type 不匹配");
    }
    return image;
}

export function requireRichMenuAlias(params: LineActionParams): string {
    const alias = requireString(params, "alias_id");
    if (!/^[a-z0-9_-]{1,32}$/u.test(alias)) {
        throw invalidParams("LINE alias_id 必须是 1 到 32 位小写字母、数字、下划线或连字符");
    }
    return alias;
}

export function richMenuBulkLinkRequest(
    params: LineActionParams,
): messagingApi.RichMenuBulkLinkRequest {
    const request = requireRecord(params, "request");
    exactParams(request, ["richMenuId", "userIds"]);
    return {
        richMenuId: requireString(request, "richMenuId"),
        userIds: richMenuUsers(request),
    };
}

export function richMenuBulkUnlinkRequest(
    params: LineActionParams,
): messagingApi.RichMenuBulkUnlinkRequest {
    const request = requireRecord(params, "request");
    exactParams(request, ["userIds"]);
    return { userIds: richMenuUsers(request) };
}

function richMenuUsers(request: Readonly<Record<string, unknown>>): string[] {
    const users = requireStringArray(request, "userIds");
    if (users.length > 500) {
        throw invalidParams("LINE Rich Menu 批量用户数不能超过 500");
    }
    if (new Set(users).size !== users.length) {
        throw invalidParams("LINE Rich Menu 批量用户 ID 不能重复");
    }
    return users;
}

function hasImageSignature(bytes: Buffer, contentType: string): boolean {
    if (contentType === "image/png") {
        return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
