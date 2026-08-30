import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const UPDATE_FIELDS = ["name", "description", "is_archived"] as const;

/** 仅组织管理员可执行的 Channel Folder 写动作。 */
export const ZULIP_CHANNEL_FOLDER_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_channel_folder",
    "reorder_channel_folders",
    "update_channel_folder",
]);

/** Zulip Channel Folder 资源动作。 */
export const ZULIP_CHANNEL_FOLDER_ACTION_HANDLERS = {
    list_channel_folders: (client, params) => {
        const input = exactParams(params, ["include_archived"]);
        if (input.include_archived !== undefined) {
            requireBoolean(input.include_archived, "include_archived");
        }
        return client.call("channel_folders", "GET", input);
    },
    create_channel_folder: (client, params) =>
        client.call("channel_folders/create", "POST", createParams(params)),
    reorder_channel_folders: (client, params) => {
        const input = exactParams(params, ["order"], ["order"]);
        const order = requireIntegerArray(input.order, "order");
        if (new Set(order).size !== order.length) invalid("Zulip 参数 order 不能包含重复 ID");
        return client.call("channel_folders", "PATCH", input);
    },
    update_channel_folder: (client, params) => {
        const folderId = requireInteger(params.channel_folder_id, "channel_folder_id");
        const body = { ...params };
        delete body.channel_folder_id;
        const input = exactParams(body, UPDATE_FIELDS);
        assertHasAny(input, UPDATE_FIELDS);
        if (input.name !== undefined) requireString(input.name, "name");
        if (input.description !== undefined) requireText(input.description, "description");
        if (input.is_archived !== undefined) requireBoolean(input.is_archived, "is_archived");
        return client.call(`channel_folders/${folderId}`, "PATCH", input);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function createParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(params, ["name", "description"], ["name"]);
    requireString(input.name, "name");
    if (input.description !== undefined) requireText(input.description, "description");
    return input;
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
