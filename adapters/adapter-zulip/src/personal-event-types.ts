interface ZulipPersonalBaseEvent {
    id: number;
    type: string;
    [key: string]: unknown;
}

export interface ZulipScheduledMessage extends Record<string, unknown> {
    scheduled_message_id: number;
    type: "stream" | "private";
    to: number | number[];
    topic?: string;
    content: string;
    rendered_content: string;
    scheduled_delivery_timestamp: number;
    failed: boolean;
}

export interface ZulipScheduledMessagesAddEvent extends ZulipPersonalBaseEvent {
    type: "scheduled_messages";
    op: "add";
    scheduled_messages: ZulipScheduledMessage[];
}

export interface ZulipScheduledMessagesUpdateEvent extends ZulipPersonalBaseEvent {
    type: "scheduled_messages";
    op: "update";
    scheduled_message: ZulipScheduledMessage;
}

export interface ZulipScheduledMessagesRemoveEvent extends ZulipPersonalBaseEvent {
    type: "scheduled_messages";
    op: "remove";
    scheduled_message_id: number;
}

export type ZulipScheduledMessagesEvent =
    | ZulipScheduledMessagesAddEvent
    | ZulipScheduledMessagesUpdateEvent
    | ZulipScheduledMessagesRemoveEvent;

export interface ZulipReminder extends Record<string, unknown> {
    reminder_id: number;
    type: "private";
    to: number[];
    content: string;
    rendered_content: string;
    scheduled_delivery_timestamp: number;
    failed: boolean;
    reminder_target_message_id: number;
}

export interface ZulipRemindersAddEvent extends ZulipPersonalBaseEvent {
    type: "reminders";
    op: "add";
    reminders: ZulipReminder[];
}

export interface ZulipRemindersRemoveEvent extends ZulipPersonalBaseEvent {
    type: "reminders";
    op: "remove";
    reminder_id: number;
}

export type ZulipRemindersEvent = ZulipRemindersAddEvent | ZulipRemindersRemoveEvent;
