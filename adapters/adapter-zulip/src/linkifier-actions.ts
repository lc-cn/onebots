import type { PlatformActionHandler } from "onebots";
import {
    exactParams,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireStringArray,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import type { ZulipParams } from "./types.js";

const LINKIFIER_FIELDS = [
    "pattern",
    "url_template",
    "example_input",
    "reverse_template",
    "alternative_url_templates",
] as const;

export const ZULIP_LINKIFIER_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_linkifier",
    "update_linkifier",
    "delete_linkifier",
    "reorder_linkifiers",
]);

/** Zulip 12 组织 Linkifier 资源动作。 */
export const ZULIP_LINKIFIER_ACTION_HANDLERS = {
    list_linkifiers: (client, params) => {
        exactParams(params, []);
        return client.call("realm/linkifiers");
    },
    create_linkifier: (client, params) =>
        client.call("realm/filters", "POST", linkifierParams(params)),
    update_linkifier: (client, params) => {
        const filterId = requireInteger(params.filter_id, "filter_id");
        const body = { ...params };
        delete body.filter_id;
        return client.call(`realm/filters/${filterId}`, "PATCH", linkifierParams(body));
    },
    delete_linkifier: (client, params) => {
        const filterId = pathId(params);
        return client.call(`realm/filters/${filterId}`, "DELETE");
    },
    reorder_linkifiers: (client, params) => {
        const result = exactParams(params, ["ordered_linkifier_ids"], ["ordered_linkifier_ids"]);
        requireIntegerArray(result.ordered_linkifier_ids, "ordered_linkifier_ids");
        return client.call("realm/linkifiers", "PATCH", result);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function linkifierParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const result = exactParams(params, LINKIFIER_FIELDS, ["pattern", "url_template"]);
    requireString(result.pattern, "pattern");
    requireString(result.url_template, "url_template");
    validateNullableText(result.example_input, "example_input");
    validateNullableText(result.reverse_template, "reverse_template");
    if (result.alternative_url_templates !== undefined) {
        requireStringArray(result.alternative_url_templates, "alternative_url_templates");
    }
    return result;
}

function pathId(params: Readonly<Record<string, unknown>>): number {
    const filterId = requireInteger(params.filter_id, "filter_id");
    const body = { ...params };
    delete body.filter_id;
    exactParams(body, []);
    return filterId;
}

function validateNullableText(value: unknown, name: string): void {
    if (value === undefined || value === null) return;
    requireText(value, name);
}
