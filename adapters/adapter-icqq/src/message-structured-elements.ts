import type { OutgoingHttpHeaders } from "node:http";
import type {
    Button,
    ButtonElem,
    MarkdownElem,
    PttElem,
    VideoElem,
} from "@icqqjs/icqq/lib/message";
import { invalidICQQParam } from "./errors.js";
import {
    optionalBoolean,
    optionalInteger,
    optionalString,
    optionalStringArray,
    requireInteger,
    requireRecord,
    requireString,
} from "./message-input.js";

/** 解析 Markdown 签名配置；配置存在时必须闭合，避免延迟到 SDK 内部失败。 */
export function markdownConfig(value: unknown): MarkdownElem["config"] | undefined {
    if (value === undefined) return undefined;
    const config = requireRecord(value, "markdown.config");
    return {
        time: requireInteger(config.time, "markdown.config.time"),
        token: requireString(config.token, "markdown.config.token"),
        unknown: optionalInteger(config.unknown, "markdown.config.unknown"),
    };
}

/** 严格解析 QQ 交互按钮，完整保留权限与客户端行为配置。 */
export function buttonContent(value: unknown): ButtonElem["content"] {
    const content = requireRecord(value, "button.content");
    if (!Array.isArray(content.rows)) {
        throw invalidICQQParam("button.content.rows 必须是数组", content.rows);
    }
    return {
        appid: requireInteger(content.appid, "button.content.appid"),
        rows: content.rows.map((row, rowIndex) => {
            const parsed = requireRecord(row, `button.content.rows[${rowIndex}]`);
            if (!Array.isArray(parsed.buttons)) {
                throw invalidICQQParam(
                    `button.content.rows[${rowIndex}].buttons 必须是数组`,
                    parsed.buttons,
                );
            }
            return {
                buttons: parsed.buttons.map((button, buttonIndex) =>
                    parseButton(button, `button.content.rows[${rowIndex}].buttons[${buttonIndex}]`),
                ),
            };
        }),
    };
}

/** fetch/HTTP 风格 headers 到 Node SDK headers 的受控边界。 */
export function optionalHeaders(value: unknown, field: string): OutgoingHttpHeaders | undefined {
    if (value === undefined) return undefined;
    const headers = requireRecord(value, field);
    return Object.fromEntries(
        Object.entries(headers).map(([name, header]) => {
            if (
                typeof header !== "string" &&
                typeof header !== "number" &&
                !isStringArray(header)
            ) {
                throw invalidICQQParam(`${field}.${name} 必须是字符串、数字或字符串数组`, header);
            }
            return [name, header];
        }),
    );
}

export function recordOptions(
    data: Readonly<Record<string, unknown>>,
    type: string,
): Partial<Omit<PttElem, "type" | "file">> {
    return {
        fid: optionalString(data.file_id ?? data.fid, `${type}.file_id`),
        md5: optionalString(data.md5, `${type}.md5`),
        sha1: optionalString(data.sha1, `${type}.sha1`),
        size: optionalInteger(data.size, `${type}.size`),
        seconds: optionalInteger(data.duration ?? data.seconds, `${type}.duration`),
        brief: optionalString(data.brief, `${type}.brief`),
        transcode: optionalBoolean(data.transcode, `${type}.transcode`),
        temp: optionalBoolean(data.temp, `${type}.temp`),
        nt: optionalBoolean(data.nt, `${type}.nt`),
    };
}

export function videoOptions(
    data: Readonly<Record<string, unknown>>,
    type: string,
): Partial<Omit<VideoElem, "type" | "file">> {
    return {
        name: optionalString(data.name, `${type}.name`),
        fid: optionalString(data.file_id ?? data.fid, `${type}.file_id`),
        md5: optionalString(data.md5, `${type}.md5`),
        sha1: optionalString(data.sha1, `${type}.sha1`),
        width: optionalInteger(data.width, `${type}.width`),
        height: optionalInteger(data.height, `${type}.height`),
        size: optionalInteger(data.size, `${type}.size`),
        seconds: optionalInteger(data.duration ?? data.seconds, `${type}.duration`),
        temp: optionalBoolean(data.temp, `${type}.temp`),
        nt: optionalBoolean(data.nt, `${type}.nt`),
    };
}

function parseButton(value: unknown, field: string): Button {
    const button = requireRecord(value, field);
    const render = requireRecord(button.render_data, `${field}.render_data`);
    const action = requireRecord(button.action, `${field}.action`);
    const permission = requireRecord(action.permission, `${field}.action.permission`);
    return {
        id: optionalString(button.id, `${field}.id`),
        render_data: {
            label: requireString(render.label, `${field}.render_data.label`),
            visited_label: requireString(
                render.visited_label,
                `${field}.render_data.visited_label`,
            ),
            style: enumInteger(render.style, `${field}.render_data.style`, [0, 1]),
        },
        action: {
            type: enumInteger(action.type, `${field}.action.type`, [0, 1, 2]),
            permission: {
                type: enumInteger(permission.type, `${field}.action.permission.type`, [0, 1, 2, 3]),
                specify_user_ids: optionalStringArray(
                    permission.specify_user_ids,
                    `${field}.action.permission.specify_user_ids`,
                ),
                specify_role_ids: optionalStringArray(
                    permission.specify_role_ids,
                    `${field}.action.permission.specify_role_ids`,
                ),
            },
            data: requireString(action.data, `${field}.action.data`),
            reply: optionalBoolean(action.reply, `${field}.action.reply`),
            enter: optionalBoolean(action.enter, `${field}.action.enter`),
            anchor: optionalInteger(action.anchor, `${field}.action.anchor`),
            click_limit: optionalInteger(action.click_limit, `${field}.action.click_limit`),
            at_bot_show_channel_list: optionalBoolean(
                action.at_bot_show_channel_list,
                `${field}.action.at_bot_show_channel_list`,
            ),
            unsupport_tips: requireString(action.unsupport_tips, `${field}.action.unsupport_tips`),
        },
    };
}

function enumInteger(value: unknown, field: string, allowed: readonly number[]): number {
    const parsed = requireInteger(value, field);
    if (!allowed.includes(parsed)) {
        throw invalidICQQParam(`${field} 只能是 ${allowed.join("、")}`, value);
    }
    return parsed;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}
