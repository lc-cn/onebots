import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger } from "./action-params.js";
import type { ZulipClient } from "./client.js";

export const ZULIP_SELF_DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set([
    "deactivate_own_account",
]);
export const ZULIP_OWNER_DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set([
    "deactivate_organization",
]);
export const ZULIP_SELF_CREDENTIAL_ACTIONS: ReadonlySet<string> = new Set([
    "regenerate_own_api_key",
]);

/** Zulip 账号与组织停用动作。调用成功后当前连接将失去认证能力。 */
export const ZULIP_LIFECYCLE_ACTION_HANDLERS = {
    regenerate_own_api_key: (client, params) => {
        exactParams(params, []);
        return client.call("users/me/api_key/regenerate", "POST");
    },
    deactivate_own_account: (client, params) => {
        exactParams(params, []);
        return client.call("users/me", "DELETE");
    },
    deactivate_organization: (client, params) => {
        const input = exactParams(params, ["deletion_delay_days"]);
        if (input.deletion_delay_days !== undefined && input.deletion_delay_days !== null) {
            requireInteger(input.deletion_delay_days, "deletion_delay_days");
        }
        return client.call("realm/deactivate", "POST", input);
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;
