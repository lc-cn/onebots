import { ReliableEventIngress, sha256Json } from "onebots";
import type { Activity } from "@microsoft/agents-activity";
import { ActivityTypes } from "@microsoft/agents-activity";
import { transformTeamsActivity } from "./activity-transform.js";
import type { TeamsEvent } from "./types.js";

export type TeamsActivityChannel =
    | "private_message"
    | "group_message"
    | "message_edited"
    | "message_deleted"
    | "member_joined"
    | "member_left"
    | "reaction_added"
    | "reaction_removed"
    | "event";

export interface TeamsActivityDelivery {
    channel: TeamsActivityChannel;
    event: TeamsEvent;
}

export interface TeamsActivityIngressResult {
    event: TeamsEvent;
    delivered: boolean;
}

/** Teams HTTP、manual 与既有 Agents 连接共用的可靠 Activity 入口。 */
export class TeamsActivityIngress {
    private readonly ingress = new ReliableEventIngress<string>();

    async ingest(
        activity: Activity,
        dispatch: (
            event: TeamsEvent,
            deliveries: readonly TeamsActivityDelivery[],
        ) => void | Promise<void>,
    ): Promise<TeamsActivityIngressResult> {
        const transformed = transformTeamsActivity(activity);
        const eventId =
            transformed.id ||
            `${transformed.type}:sha256:${sha256Json({ ...transformed, id: undefined })}`;
        transformed.id = eventId;
        const event: TeamsEvent = {
            type: activity.type,
            activity: transformed,
            raw_activity: activity,
        };
        const delivered = await this.ingress.deliver(eventId, async () => {
            await dispatch(event, activityDeliveries(event));
        });
        return { event, delivered };
    }
}

function activityDeliveries(event: TeamsEvent): TeamsActivityDelivery[] {
    const activity = event.activity;
    if (activity.type === ActivityTypes.Message) {
        return [
            {
                channel: isGroupActivity(event) ? "group_message" : "private_message",
                event,
            },
        ];
    }
    if (activity.type === ActivityTypes.MessageUpdate)
        return [{ channel: "message_edited", event }];
    if (activity.type === ActivityTypes.MessageDelete)
        return [{ channel: "message_deleted", event }];
    if (activity.type === ActivityTypes.ConversationUpdate) return memberDeliveries(event);
    if (activity.type === ActivityTypes.MessageReaction) return reactionDeliveries(event);
    return [{ channel: "event", event }];
}

function memberDeliveries(event: TeamsEvent): TeamsActivityDelivery[] {
    const deliveries: TeamsActivityDelivery[] = [];
    for (const member of event.activity.membersAdded || []) {
        deliveries.push({
            channel: "member_joined",
            event: {
                ...event,
                activity: { ...event.activity, membersAdded: [member], membersRemoved: [] },
            },
        });
    }
    for (const member of event.activity.membersRemoved || []) {
        deliveries.push({
            channel: "member_left",
            event: {
                ...event,
                activity: { ...event.activity, membersAdded: [], membersRemoved: [member] },
            },
        });
    }
    return deliveries.length ? deliveries : [{ channel: "event", event }];
}

function reactionDeliveries(event: TeamsEvent): TeamsActivityDelivery[] {
    const deliveries: TeamsActivityDelivery[] = [];
    for (const reaction of event.activity.reactionsAdded || []) {
        deliveries.push({
            channel: "reaction_added",
            event: {
                ...event,
                activity: {
                    ...event.activity,
                    reactionsAdded: [reaction],
                    reactionsRemoved: [],
                },
            },
        });
    }
    for (const reaction of event.activity.reactionsRemoved || []) {
        deliveries.push({
            channel: "reaction_removed",
            event: {
                ...event,
                activity: {
                    ...event.activity,
                    reactionsAdded: [],
                    reactionsRemoved: [reaction],
                },
            },
        });
    }
    return deliveries.length ? deliveries : [{ channel: "event", event }];
}

function isGroupActivity(event: TeamsEvent): boolean {
    return Boolean(
        event.activity.conversation.isGroup ||
        ["channel", "groupChat"].includes(event.activity.conversation.conversationType || ""),
    );
}
