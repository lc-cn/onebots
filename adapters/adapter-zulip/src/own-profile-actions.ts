import { materializeMediaSource, type PlatformActionHandler } from "onebots";
import { exactParams, optionalString, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { validateProfileData, validateProfileFieldIds } from "./profile-data.js";

const AVATAR_UPLOAD_FIELDS = ["file", "filename", "content_type"] as const;

/** 可能受组织“谁可以更改资料”策略限制的本人资料动作。 */
export const ZULIP_OWN_PROFILE_PERMISSION_ACTIONS: ReadonlySet<string> = new Set([
    "update_own_profile_data",
    "remove_own_profile_data",
    "upload_own_avatar",
    "delete_own_avatar",
]);

/** 当前认证账号的资料与头像动作。 */
export const ZULIP_OWN_PROFILE_ACTION_HANDLERS = {
    get_own_user: (client, params) => {
        exactParams(params, []);
        return client.call("users/me");
    },
    update_own_profile_data: (client, params) => {
        const input = exactParams(params, ["data"], ["data"]);
        validateProfileData(input.data, "data");
        return client.call("users/me/profile_data", "PATCH", input);
    },
    remove_own_profile_data: (client, params) => {
        const input = exactParams(params, ["data"], ["data"]);
        validateProfileFieldIds(input.data);
        return client.call("users/me/profile_data", "DELETE", input);
    },
    upload_own_avatar: async (client, params) => {
        const input = exactParams(params, AVATAR_UPLOAD_FIELDS, ["file"]);
        const media = await materializeMediaSource({
            source: requireString(input.file, "file"),
            filename: optionalString(input.filename),
            contentType: optionalString(input.content_type),
        });
        return client.uploadOwnAvatar(media.data, media.filename, media.contentType);
    },
    delete_own_avatar: (client, params) => {
        exactParams(params, []);
        return client.call("users/me/avatar", "DELETE");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;
