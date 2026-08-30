import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

export const ZULIP_PLAYGROUND_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "add_code_playground",
    "remove_code_playground",
]);

/** Zulip 组织 Code Playground 资源动作。 */
export const ZULIP_PLAYGROUND_ACTION_HANDLERS = {
    add_code_playground: (client, params) => {
        const body = exactParams(
            params,
            ["name", "pygments_language", "url_template"],
            ["name", "pygments_language", "url_template"],
        );
        requireString(body.name, "name");
        requireString(body.pygments_language, "pygments_language");
        validateUrlTemplate(body.url_template);
        return client.call("realm/playgrounds", "POST", body);
    },
    remove_code_playground: (client, params) => {
        const playgroundId = requireInteger(params.playground_id, "playground_id");
        const body = { ...params };
        delete body.playground_id;
        exactParams(body, []);
        return client.call(`realm/playgrounds/${playgroundId}`, "DELETE");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function validateUrlTemplate(value: unknown): void {
    const template = requireString(value, "url_template");
    if (template.match(/\{code\}/gu)?.length !== 1 || /\{(?!code\})[^}]*\}/u.test(template)) {
        invalid("Zulip url_template 必须且只能包含一个 {code} 变量");
    }
    let url: URL;
    try {
        url = new URL(template.replace("{code}", "example"));
    } catch {
        invalid("Zulip url_template 必须是有效的绝对 URL");
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        invalid("Zulip url_template 仅支持不含凭据的 HTTP(S) URL");
    }
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
