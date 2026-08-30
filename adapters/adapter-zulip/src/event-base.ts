import { CommonEvent, type CommonTypes } from "onebots";
import type { ZulipBaseEvent, ZulipEvent } from "./types.js";

export interface ZulipProjectionContext {
    botId: CommonTypes.Id;
    botUserId?: number;
    serverUrl?: string;
    createId(value: string | number): CommonTypes.Id;
}

export function customNotice(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    return {
        ...base(event, context),
        type: "notice",
        notice_type: "custom",
        sub_type: stringValue(event.op) || event.type,
        extensions: { zulip: event },
    };
}

export function base(
    event: ZulipEvent,
    context: ZulipProjectionContext,
    timestamp = 0,
): CommonEvent.Base<ZulipEvent> {
    return {
        id: context.createId(`event:${event.id}`),
        timestamp,
        platform: "zulip",
        bot_id: context.botId,
        type: "custom",
        raw_event: event,
    };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numeric(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function numericArray(value: unknown): number[] {
    return Array.isArray(value)
        ? value.filter((item): item is number => numeric(item) !== undefined)
        : [];
}

export function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
