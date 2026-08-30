import { CommonEvent } from "onebots";
import {
    base,
    customNotice,
    isRecord,
    numeric,
    numericArray,
    stringValue,
    type ZulipProjectionContext,
} from "./event-base.js";
import type { ZulipBaseEvent, ZulipEvent } from "./types.js";

/** 投影结构化资源事件；非本模块负责的事件返回 undefined。 */
export function projectZulipResourceEvent(
    event: ZulipEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> | undefined {
    if (event.type === "attachment") return projectAttachment(event, context);
    if (event.type === "channel_folder") return projectChannelFolder(event, context);
    if (event.type === "navigation_view") return projectNavigationView(event, context);
    return undefined;
}

function projectAttachment(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = stringValue(event.op);
    const attachment = isRecord(event.attachment) ? event.attachment : undefined;
    const attachmentId = numeric(attachment?.id);
    if (
        !attachment ||
        (op !== "add" && op !== "update" && op !== "remove") ||
        attachmentId === undefined
    ) {
        return customNotice(event, context);
    }
    const createdAt = numeric(attachment.create_time);
    const pathId = stringValue(attachment.path_id);
    const url =
        pathId && context.serverUrl
            ? new URL(`user_uploads/${pathId}`, `${context.serverUrl.replace(/\/+$/, "")}/`).href
            : undefined;
    return {
        ...base(event, context, createdAt === undefined ? 0 : createdAt * 1000),
        type: "notice",
        notice_type:
            op === "add"
                ? "attachment_created"
                : op === "remove"
                  ? "attachment_removed"
                  : "attachment_updated",
        sub_type: op,
        resource: {
            ...attachment,
            type: "attachment",
            id: context.createId(attachmentId),
            ...(url === undefined ? {} : { url }),
            upload_space_used: numeric(event.upload_space_used),
        },
        extensions: { zulip: event },
    };
}

function projectChannelFolder(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = stringValue(event.op);
    const folder = isRecord(event.channel_folder) ? event.channel_folder : undefined;
    const data = isRecord(event.data) ? event.data : undefined;
    const folderId = numeric(folder?.id) ?? numeric(event.channel_folder_id);
    if (op === "reorder") {
        const order = numericArray(event.order);
        if (!Array.isArray(event.order) || order.length !== event.order.length) {
            return customNotice(event, context);
        }
        return {
            ...base(event, context),
            type: "notice",
            notice_type: "channel_folders_reordered",
            sub_type: op,
            resource: {
                type: "channel_folder",
                id: context.createId("channel_folders"),
                order,
            },
            extensions: { zulip: event },
        };
    }
    if ((op !== "add" && op !== "update") || folderId === undefined) {
        return customNotice(event, context);
    }
    const createdAt = numeric(folder?.date_created);
    const name = stringValue(folder?.name) || stringValue(data?.name);
    return {
        ...base(event, context, createdAt === undefined ? 0 : createdAt * 1000),
        type: "notice",
        notice_type: op === "add" ? "channel_folder_created" : "channel_folder_updated",
        sub_type:
            op === "update" && typeof data?.is_archived === "boolean"
                ? data.is_archived
                    ? "archived"
                    : "unarchived"
                : op,
        resource: {
            ...(folder || {}),
            ...(data || {}),
            type: "channel_folder",
            id: context.createId(folderId),
            ...(name === undefined ? {} : { name }),
        },
        extensions: { zulip: event },
    };
}

function projectNavigationView(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = stringValue(event.op);
    const view = isRecord(event.navigation_view) ? event.navigation_view : undefined;
    const data = isRecord(event.data) ? event.data : undefined;
    const fragment = stringValue(view?.fragment) || stringValue(event.fragment);
    if ((op !== "add" && op !== "update" && op !== "remove") || !fragment) {
        return customNotice(event, context);
    }
    const name = stringValue(view?.name) || stringValue(data?.name);
    const resourceData = { ...(view || {}), ...(data || {}) };
    delete resourceData.name;
    return {
        ...base(event, context),
        type: "notice",
        notice_type:
            op === "add"
                ? "navigation_view_created"
                : op === "remove"
                  ? "navigation_view_removed"
                  : "navigation_view_updated",
        sub_type: op,
        resource: {
            ...resourceData,
            type: "navigation_view",
            id: context.createId(fragment),
            ...(name === undefined ? {} : { name }),
        },
        extensions: { zulip: event },
    };
}
