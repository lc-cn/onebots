import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireInteger,
    requireString,
    without,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";

const CONTENT_FIELDS = ["title", "content"] as const;

/** Zulip 当前用户保存片段资源动作。 */
export const ZULIP_SAVED_SNIPPET_ACTION_HANDLERS = {
    get_saved_snippets: client => client.call("saved_snippets"),
    create_saved_snippet: (client, params) => {
        const input = exactParams(params, CONTENT_FIELDS, CONTENT_FIELDS);
        validateContent(input);
        return client.call("saved_snippets", "POST", input);
    },
    edit_saved_snippet: (client, params) => {
        const input = exactParams(
            params,
            ["saved_snippet_id", ...CONTENT_FIELDS],
            ["saved_snippet_id"],
        );
        const id = requireInteger(input.saved_snippet_id, "saved_snippet_id");
        const update = without(input, "saved_snippet_id");
        assertHasAny(update, CONTENT_FIELDS);
        validateContent(update);
        return client.call(`saved_snippets/${id}`, "PATCH", update);
    },
    delete_saved_snippet: (client, params) => {
        const input = exactParams(params, ["saved_snippet_id"], ["saved_snippet_id"]);
        return client.call(
            `saved_snippets/${requireInteger(input.saved_snippet_id, "saved_snippet_id")}`,
            "DELETE",
        );
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function validateContent(input: Readonly<Record<string, unknown>>): void {
    if (input.title !== undefined) requireString(input.title, "title");
    if (input.content !== undefined) requireString(input.content, "content");
}
