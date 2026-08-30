import type { PlatformActionHandler } from "onebots";
import { exactParams, requireBoolean, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

export const ZULIP_DOMAIN_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "add_allowed_domain",
    "update_allowed_domain",
    "remove_allowed_domain",
]);

/** Zulip 组织 Allowed Domain 策略资源动作。 */
export const ZULIP_DOMAIN_ACTION_HANDLERS = {
    list_allowed_domains: (client, params) => {
        exactParams(params, []);
        return client.call("realm/domains");
    },
    add_allowed_domain: (client, params) => {
        const body = exactParams(
            params,
            ["domain", "allow_subdomains"],
            ["domain", "allow_subdomains"],
        );
        const domain = requireDomain(body.domain);
        requireBoolean(body.allow_subdomains, "allow_subdomains");
        return client.call("realm/domains", "POST", { ...body, domain });
    },
    update_allowed_domain: (client, params) => {
        const domain = requireDomain(params.domain);
        const body = { ...params };
        delete body.domain;
        const input = exactParams(body, ["allow_subdomains"], ["allow_subdomains"]);
        requireBoolean(input.allow_subdomains, "allow_subdomains");
        return client.call(`realm/domains/${encodeURIComponent(domain)}`, "PATCH", input);
    },
    remove_allowed_domain: (client, params) => {
        const domain = requireDomain(params.domain);
        const body = { ...params };
        delete body.domain;
        exactParams(body, []);
        return client.call(`realm/domains/${encodeURIComponent(domain)}`, "DELETE");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function requireDomain(value: unknown): string {
    const domain = requireString(value, "domain").trim().toLowerCase();
    if (["://", "/", "?", "#", "@"].some(fragment => domain.includes(fragment))) {
        throw new ZulipError("Zulip domain 必须是不含协议、路径或凭据的邮箱域名", {
            code: "ZULIP_INVALID_DOMAIN",
        });
    }
    return domain;
}
