import type { Client } from "@icqqjs/icqq";
import type { Anonymous, Forwardable } from "@icqqjs/icqq/lib/message";
import { compileICQQMessage } from "./messages.js";
import { requireSegments } from "./message-input.js";
import {
    optionalBoolean,
    optionalInteger,
    optionalString,
    record,
    requiredInteger,
    requiredQQNumber,
    requiredString,
    type ICQQPlatformActionParams,
} from "./platform-action-input.js";
import { invalidICQQParam } from "./errors.js";

export async function makeForwardMessage(
    client: Client,
    params: ICQQPlatformActionParams,
): Promise<unknown> {
    if (!Array.isArray(params.nodes)) {
        throw invalidICQQParam("nodes 必须是转发节点数组", params.nodes);
    }
    const nodes: Forwardable[] = params.nodes.map((value, index) => {
        const node = record(value, `nodes[${index}]`);
        return {
            user_id: requiredQQNumber(node.user_id, `nodes[${index}].user_id`),
            message: platformMessage(node.message, `nodes[${index}].message`),
            nickname: optionalString(node.nickname),
            time: namedOptionalInteger(node.time, `nodes[${index}].time`),
            seq: namedOptionalInteger(node.seq, `nodes[${index}].seq`),
            rand: namedOptionalInteger(node.rand, `nodes[${index}].rand`),
            preview: optionalString(node.preview),
        };
    });
    return client.makeForwardMsg(nodes, optionalBoolean(params.dm));
}

export async function sendGroupAnonymousMessage(
    client: Client,
    params: ICQQPlatformActionParams,
): Promise<unknown> {
    return client
        .pickGroup(requiredQQNumber(params.group_id, "group_id"))
        .sendMsg(
            platformMessage(params.message, "message"),
            undefined,
            anonymousConfig(params.anonymous),
        );
}

export async function getGroupFileEntries(
    client: Client,
    params: ICQQPlatformActionParams,
): Promise<unknown> {
    const start = nonNegativeInteger(params.start, "start");
    const limit = positiveInteger(params.limit, "limit");
    return client
        .acquireGfs(requiredQQNumber(params.group_id, "group_id"))
        .dir(optionalString(params.folder_id), start, limit);
}

export async function downloadGroupFile(
    client: Client,
    params: ICQQPlatformActionParams,
): Promise<unknown> {
    return client
        .acquireGfs(requiredQQNumber(params.group_id, "group_id"))
        .download(requiredString(params.file_id, "file_id"));
}

function platformMessage(value: unknown, field: string) {
    return compileICQQMessage(requireSegments(value, field));
}

function anonymousConfig(value: unknown): Omit<Anonymous, "flag"> | boolean {
    if (value === undefined) return true;
    if (typeof value === "boolean") return value;
    const anonymous = record(value, "anonymous");
    return {
        enable: requiredBoolean(anonymous.enable, "anonymous.enable"),
        id: requiredInteger(anonymous.id, "anonymous.id"),
        id2: requiredInteger(anonymous.id2, "anonymous.id2"),
        name: requiredString(anonymous.name, "anonymous.name"),
        expire_time: requiredInteger(anonymous.expire_time, "anonymous.expire_time"),
        color: requiredString(anonymous.color, "anonymous.color"),
    };
}

function namedOptionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requiredInteger(value, field);
}

function nonNegativeInteger(value: unknown, field: string): number | undefined {
    const parsed = optionalInteger(value);
    if (parsed !== undefined && parsed < 0) throw invalidICQQParam(`${field} 不能小于 0`, value);
    return parsed;
}

function positiveInteger(value: unknown, field: string): number | undefined {
    const parsed = optionalInteger(value);
    if (parsed !== undefined && parsed <= 0) throw invalidICQQParam(`${field} 必须大于 0`, value);
    return parsed;
}

function requiredBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw invalidICQQParam(`${field} 必须是布尔值`, value);
    return value;
}
