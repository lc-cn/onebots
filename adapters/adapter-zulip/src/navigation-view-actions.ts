import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireString,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import type { ZulipParams } from "./types.js";

const UPDATE_FIELDS = ["name", "is_pinned"] as const;

/** 当前用户的 Navigation View 资源动作。 */
export const ZULIP_NAVIGATION_VIEW_ACTION_HANDLERS = {
    list_navigation_views: (client, params) => {
        exactParams(params, []);
        return client.call("navigation_views");
    },
    add_navigation_view: (client, params) =>
        client.call("navigation_views", "POST", createParams(params)),
    update_navigation_view: (client, params) => {
        const fragment = requireString(params.fragment, "fragment");
        const body = { ...params };
        delete body.fragment;
        const input = exactParams(body, UPDATE_FIELDS);
        assertHasAny(input, UPDATE_FIELDS);
        if (input.name !== undefined) requireText(input.name, "name");
        if (input.is_pinned !== undefined) requireBoolean(input.is_pinned, "is_pinned");
        return client.call(`navigation_views/${encodeURIComponent(fragment)}`, "PATCH", input);
    },
    remove_navigation_view: (client, params) => {
        const input = exactParams(params, ["fragment"], ["fragment"]);
        const fragment = requireString(input.fragment, "fragment");
        return client.call(`navigation_views/${encodeURIComponent(fragment)}`, "DELETE");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function createParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(params, ["fragment", "is_pinned", "name"], ["fragment", "is_pinned"]);
    requireString(input.fragment, "fragment");
    requireBoolean(input.is_pinned, "is_pinned");
    if (input.name !== undefined && input.name !== null) requireText(input.name, "name");
    return input;
}
