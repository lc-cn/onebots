import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

/** 当前用户上传的附件与临时访问动作。 */
export const ZULIP_ATTACHMENT_ACTION_HANDLERS = {
    get_attachments: (client, params) => {
        exactParams(params, []);
        return client.call("attachments");
    },
    remove_attachment: (client, params) => {
        const input = exactParams(params, ["attachment_id"], ["attachment_id"]);
        const attachmentId = requireInteger(input.attachment_id, "attachment_id");
        return client.call(`attachments/${attachmentId}`, "DELETE");
    },
    get_attachment_temporary_url: (client, params) => {
        const path = attachmentPath(params);
        return client.call(`user_uploads/${path}`);
    },
    check_attachment_thumbnail: (client, params) => {
        const path = attachmentPath(params);
        return client.call(`thumbnail/status/${path}`);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function attachmentPath(params: Readonly<Record<string, unknown>>): string {
    const input = exactParams(params, ["realm_id_str", "filename"], ["realm_id_str", "filename"]);
    const realmId = requireInteger(input.realm_id_str, "realm_id_str");
    const filename = requireString(input.filename, "filename");
    const segments = filename.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === "..")) {
        throw new ZulipError("Zulip 参数 filename 必须是安全的附件相对路径", {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
    return `${realmId}/${segments.map(encodePathSegment).join("/")}`;
}

/** encodeURIComponent 不编码的少数保留字符也不应逸出 API 路径段。 */
function encodePathSegment(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}
