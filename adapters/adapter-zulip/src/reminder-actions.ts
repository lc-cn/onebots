import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireText } from "./action-params.js";
import type { ZulipClient } from "./client.js";

/** Zulip 消息提醒资源动作。 */
export const ZULIP_REMINDER_ACTION_HANDLERS = {
    get_reminders: client => client.call("reminders"),
    create_reminder: (client, params) => {
        const input = exactParams(
            params,
            ["message_id", "scheduled_delivery_timestamp", "note"],
            ["message_id", "scheduled_delivery_timestamp"],
        );
        requireInteger(input.message_id, "message_id");
        requireInteger(input.scheduled_delivery_timestamp, "scheduled_delivery_timestamp");
        if (input.note !== undefined) requireText(input.note, "note");
        return client.call("reminders", "POST", input);
    },
    delete_reminder: (client, params) => {
        const input = exactParams(params, ["reminder_id"], ["reminder_id"]);
        return client.call(
            `reminders/${requireInteger(input.reminder_id, "reminder_id")}`,
            "DELETE",
        );
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;
